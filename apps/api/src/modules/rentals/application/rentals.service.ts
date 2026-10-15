import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/domain/user.entity';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationType } from '../../notifications/domain/notification.entity';
import { Property } from '../../properties/domain/property.entity';
import { RentalAdjustment } from '../domain/rental-adjustment.entity';
import { RentalContract } from '../domain/rental-contract.entity';
import { RentalPayment } from '../domain/rental-payment.entity';
import { AdjustmentResult, addMonths, computeAdjustment, formatDate, monthOf, nextAdjustmentDate, PeriodStatus, periodsStatus } from '../domain/rent-calc';
import { AdjustmentIndex, ContractStatus, RentCurrency } from '../domain/rental.enums';
import { IndexService, todayAr } from './index.service';

export interface ContractInput {
  propertyId: string;
  tenantName: string;
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  tenantDocument?: string | null;
  ownerName: string;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  startDate: string;
  endDate: string;
  currency?: RentCurrency;
  initialRent: number;
  paymentDueDay?: number;
  deposit?: number | null;
  adminFeePct?: number | null;
  adjustmentIndex: AdjustmentIndex;
  adjustmentEveryMonths: number;
  fixedRatePct?: number | null;
  notes?: string | null;
  /**
   * Solo al crear un contrato que ya venía de antes: los meses hasta este (inclusive, YYYY-MM-DD) se registran
   * como pagos, así no aparecen como deuda.
   */
  paidThrough?: string | null;
}

export interface ContractSummary {
  contract: RentalContract;
  /** Total de meses vencidos sin pagar. */
  debt: number;
  overdueMonths: number;
  /** Mes en curso. */
  current: PeriodStatus | null;
}

/** Con cuánta anticipación se avisa (y se deja aplicar) un ajuste: hay que comunicarlo al inquilino antes. */
const ADJUSTMENT_NOTICE_DAYS = 30;
const EXPIRY_NOTICE_DAYS = 60;

@Injectable()
export class RentalsService {
  private readonly logger = new Logger(RentalsService.name);

  constructor(
    @InjectRepository(RentalContract) private readonly contracts: Repository<RentalContract>,
    @InjectRepository(RentalAdjustment) private readonly adjustments: Repository<RentalAdjustment>,
    @InjectRepository(RentalPayment) private readonly payments: Repository<RentalPayment>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly indexes: IndexService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- contratos

  async list(opts: { status?: ContractStatus; q?: string }, today = todayAr()): Promise<ContractSummary[]> {
    const qb = this.contracts
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.property', 'p')
      .leftJoinAndSelect('c.adjustments', 'a')
      .leftJoinAndSelect('c.payments', 'pay')
      .orderBy('c.status', 'ASC')
      .addOrderBy('c.endDate', 'ASC');
    if (opts.status) qb.andWhere('c.status = :status', { status: opts.status });
    if (opts.q?.trim()) {
      qb.andWhere('(c.tenant_name ILIKE :q OR c.owner_name ILIKE :q OR p.title ILIKE :q OR p.address ILIKE :q)', { q: `%${opts.q.trim()}%` });
    }
    const rows = await qb.getMany();
    return rows.map((c) => {
      const s = this.summary(c, today);
      delete c.adjustments;
      delete c.payments;
      return s;
    });
  }

  async findOne(id: string, today = todayAr()) {
    const contract = await this.contracts.findOne({
      where: { id },
      relations: { property: true, adjustments: true, payments: true },
      order: { adjustments: { effectiveDate: 'DESC' }, payments: { paidAt: 'DESC', createdAt: 'DESC' } },
    });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    const periods = this.periods(contract, today).reverse();
    const s = this.summary(contract, today);
    const adjustment = await this.preview(contract, today);
    return { ...contract, periods, debt: s.debt, overdueMonths: s.overdueMonths, nextAdjustment: adjustment };
  }

  async create({ paidThrough, ...input }: ContractInput, userId?: string): Promise<RentalContract> {
    const property = await this.properties.findOne({ where: { id: input.propertyId } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    this.validate(input);
    const contract = this.contracts.create({
      ...input,
      property,
      currentRent: input.initialRent,
      lastAdjustmentDate: input.startDate,
      nextAdjustmentDate: nextAdjustmentDate(input.startDate, this.every(input), input.endDate),
      status: ContractStatus.ACTIVO,
    });
    const saved = await this.contracts.save(contract);
    if (paidThrough) {
      const author = userId ? await this.users.findOne({ where: { id: userId } }) : null;
      const last = monthOf(paidThrough < input.endDate ? paidThrough : input.endDate);
      const rows: Partial<RentalPayment>[] = [];
      for (let period = monthOf(input.startDate); period <= last; period = addMonths(period, 1)) {
        rows.push({ contract: saved, period, amount: input.initialRent, paidAt: period < input.startDate ? input.startDate : period, method: 'Carga inicial', authorName: author?.fullName ?? author?.email ?? null });
      }
      if (rows.length) await this.payments.save(rows.map((r) => this.payments.create(r)));
    }
    return saved;
  }

  async update(id: string, input: Partial<ContractInput> & { status?: ContractStatus }): Promise<RentalContract> {
    const contract = await this.contracts.findOne({ where: { id }, relations: { property: true } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    const hasAdjustments = (await this.adjustments.count({ where: { contract: { id } } })) > 0;
    if (hasAdjustments && (input.initialRent !== undefined || input.startDate !== undefined)) {
      if ((input.initialRent ?? contract.initialRent) !== contract.initialRent || (input.startDate ?? contract.startDate) !== contract.startDate) {
        throw new ConflictException('El contrato ya tiene ajustes: el monto inicial y la fecha de inicio no se pueden cambiar (deshacé los ajustes primero)');
      }
    }
    if (input.propertyId && input.propertyId !== contract.property.id) {
      const property = await this.properties.findOne({ where: { id: input.propertyId } });
      if (!property) throw new NotFoundException('Propiedad no encontrada');
      contract.property = property;
    }
    const { propertyId: _ignored, ...rest } = input;
    Object.assign(contract, rest);
    this.validate(contract);
    if (!hasAdjustments) {
      contract.currentRent = contract.initialRent;
      contract.lastAdjustmentDate = contract.startDate;
    }
    contract.nextAdjustmentDate = nextAdjustmentDate(contract.lastAdjustmentDate, this.every(contract), contract.endDate);
    return this.contracts.save(contract);
  }

  async remove(id: string): Promise<void> {
    const res = await this.contracts.delete(id);
    if (!res.affected) throw new NotFoundException('Contrato no encontrado');
  }

  // ---------------------------------------------------------------- ajustes

  /** Cálculo del próximo ajuste (sin aplicarlo). */
  async preview(contract: RentalContract, today = todayAr()) {
    if (contract.status !== ContractStatus.ACTIVO || !contract.nextAdjustmentDate) return null;
    const date = contract.nextAdjustmentDate;
    const lookup = await this.indexes.lookupFor([contract.lastAdjustmentDate, date], monthOf(date));
    const result: AdjustmentResult = computeAdjustment(
      {
        index: contract.adjustmentIndex,
        everyMonths: contract.adjustmentEveryMonths,
        fixedRatePct: contract.fixedRatePct,
        currentRent: contract.currentRent,
        lastAdjustmentDate: contract.lastAdjustmentDate,
        adjustmentDate: date,
      },
      lookup,
    );
    return { date, canApply: date <= addDaysStr(today, ADJUSTMENT_NOTICE_DAYS), ...result };
  }

  /** Aplica el próximo ajuste. Con `newRent` se usa ese monto (editado a mano o sin índice). */
  async applyAdjustment(id: string, newRent: number | undefined, userId: string, today = todayAr()): Promise<RentalAdjustment> {
    const contract = await this.contracts.findOne({ where: { id }, relations: { property: true } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    const preview = await this.preview(contract, today);
    if (!preview) throw new ConflictException('Este contrato no tiene ajustes pendientes');
    if (!preview.canApply) throw new ConflictException(`El ajuste es el ${formatDate(preview.date)}: se puede aplicar desde ${ADJUSTMENT_NOTICE_DAYS} días antes`);
    if (newRent === undefined && !preview.ok) throw new BadRequestException(`${preview.reason}. También podés ingresar el nuevo monto a mano.`);

    const amount = newRent ?? (preview.ok ? preview.newRent : 0);
    const author = await this.users.findOne({ where: { id: userId } });
    const adjustment = this.adjustments.create({
      contract,
      effectiveDate: preview.date,
      previousRent: contract.currentRent,
      newRent: amount,
      factor: Math.round((amount / contract.currentRent) * 1e6) / 1e6,
      index: contract.adjustmentIndex,
      detail: preview.ok ? { ...preview.detail, ...(newRent !== undefined && newRent !== preview.newRent ? { calculated: preview.newRent, manual: true } : {}) } : { manual: true },
      authorName: author?.fullName ?? author?.email ?? null,
    });
    await this.adjustments.save(adjustment);
    contract.currentRent = amount;
    contract.lastAdjustmentDate = preview.date;
    contract.nextAdjustmentDate = nextAdjustmentDate(preview.date, this.every(contract), contract.endDate);
    await this.contracts.save(contract);
    await this.notifications.resolveContract(NotificationType.ALQUILER_AJUSTE, contract.id);
    delete (adjustment as Partial<RentalAdjustment>).contract;
    return adjustment;
  }

  /** Deshace el último ajuste (por si se aplicó con un error). */
  async undoLastAdjustment(id: string): Promise<void> {
    const contract = await this.contracts.findOne({ where: { id } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    const [last, previous] = await this.adjustments.find({ where: { contract: { id } }, order: { effectiveDate: 'DESC' }, take: 2 });
    if (!last) throw new ConflictException('No hay ajustes para deshacer');
    await this.adjustments.delete(last.id);
    contract.currentRent = last.previousRent;
    contract.lastAdjustmentDate = previous?.effectiveDate ?? contract.startDate;
    contract.nextAdjustmentDate = nextAdjustmentDate(contract.lastAdjustmentDate, this.every(contract), contract.endDate);
    await this.contracts.save(contract);
  }

  // ---------------------------------------------------------------- pagos

  async addPayment(id: string, input: { period: string; amount: number; paidAt: string; method?: string | null; notes?: string | null }, userId: string) {
    const contract = await this.contracts.findOne({ where: { id } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    const period = monthOf(input.period);
    if (period < monthOf(contract.startDate) || period > monthOf(contract.endDate)) {
      throw new BadRequestException('Ese mes está fuera del período del contrato');
    }
    const author = await this.users.findOne({ where: { id: userId } });
    const payment = await this.payments.save(
      this.payments.create({ ...input, period, contract, authorName: author?.fullName ?? author?.email ?? null }),
    );
    delete (payment as Partial<RentalPayment>).contract;
    await this.refreshDebtNotice(id);
    return payment;
  }

  async removePayment(id: string, paymentId: string): Promise<void> {
    const res = await this.payments.delete({ id: paymentId, contract: { id } });
    if (!res.affected) throw new NotFoundException('Pago no encontrado');
    await this.refreshDebtNotice(id);
  }

  // ---------------------------------------------------------------- control diario

  /** Todos los días: actualiza los índices y avisa ajustes próximos, contratos por vencer y deudas. */
  @Cron('30 8 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async dailyCheck(today = todayAr()): Promise<void> {
    await this.indexes.sync(today);
    const active = await this.contracts.find({ where: { status: ContractStatus.ACTIVO }, relations: { property: true, adjustments: true, payments: true } });
    for (const c of active) {
      try {
        await this.checkContract(c, today);
      } catch (err) {
        this.logger.error(`Control del contrato ${c.id}: ${(err as Error).message}`);
      }
    }
  }

  private async checkContract(c: RentalContract, today: string): Promise<void> {
    const where = c.property.title;
    if (c.nextAdjustmentDate && c.nextAdjustmentDate <= addDaysStr(today, 7)) {
      const p = await this.preview(c, today);
      if (p) {
        const body = p.ok
          ? `Desde el ${formatDate(p.date)} pasa de ${money(c.currentRent, c.currency)} a ${money(p.newRent, c.currency)} (${pct(p.factor)}). Aplicalo y avisale a ${c.tenantName}.`
          : `El ${formatDate(p.date)} se ajusta, pero no se puede calcular: ${p.reason}.`;
        await this.notifications.notifyContract(NotificationType.ALQUILER_AJUSTE, `Ajuste de alquiler: ${where}`, body, c.id);
      }
    }
    if (c.endDate <= addDaysStr(today, EXPIRY_NOTICE_DAYS)) {
      const ended = c.endDate < today;
      await this.notifications.notifyContract(
        NotificationType.ALQUILER_VENCE,
        `${ended ? 'Contrato vencido' : 'Contrato por vencer'}: ${where}`,
        `${ended ? 'Venció' : 'Vence'} el ${formatDate(c.endDate)}. Coordiná con ${c.tenantName} y ${c.ownerName} la renovación o la entrega.`,
        c.id,
      );
    }
    await this.refreshDebtNotice(c.id, c, today);
  }

  private async refreshDebtNotice(id: string, loaded?: RentalContract, today = todayAr()): Promise<void> {
    const c = loaded ?? (await this.contracts.findOne({ where: { id }, relations: { property: true, adjustments: true, payments: true } }));
    if (!c) return;
    const s = this.summary(c, today);
    if (s.debt > 0 && c.status === ContractStatus.ACTIVO) {
      await this.notifications.notifyContract(
        NotificationType.ALQUILER_DEUDA,
        `Alquiler impago: ${c.property.title}`,
        `${c.tenantName} debe ${money(s.debt, c.currency)} (${s.overdueMonths} ${s.overdueMonths === 1 ? 'mes' : 'meses'}).`,
        c.id,
      );
    } else {
      await this.notifications.resolveContract(NotificationType.ALQUILER_DEUDA, c.id);
    }
  }

  // ---------------------------------------------------------------- auxiliares

  private periods(c: RentalContract, today: string): PeriodStatus[] {
    return periodsStatus({
      startDate: c.startDate,
      endDate: c.endDate,
      initialRent: c.initialRent,
      paymentDueDay: c.paymentDueDay,
      adjustments: c.adjustments ?? [],
      payments: c.payments ?? [],
      today,
    });
  }

  private summary(c: RentalContract, today: string): ContractSummary {
    const periods = this.periods(c, today);
    const overdue = periods.filter((p) => p.overdue);
    return {
      contract: c,
      debt: overdue.reduce((s, p) => s + p.balance, 0),
      overdueMonths: overdue.length,
      current: periods.find((p) => p.period === monthOf(today)) ?? null,
    };
  }

  private every(c: Pick<ContractInput, 'adjustmentIndex' | 'adjustmentEveryMonths'>): number {
    return c.adjustmentEveryMonths;
  }

  private validate(c: Pick<ContractInput, 'startDate' | 'endDate' | 'adjustmentIndex' | 'fixedRatePct' | 'adjustmentEveryMonths' | 'initialRent'>): void {
    if (c.endDate <= c.startDate) throw new BadRequestException('La fecha de fin tiene que ser posterior a la de inicio');
    if (c.adjustmentIndex === AdjustmentIndex.FIJO && (c.fixedRatePct == null || c.fixedRatePct <= 0)) {
      throw new BadRequestException('Con ajuste por porcentaje fijo, indicá el porcentaje');
    }
    if (c.initialRent <= 0) throw new BadRequestException('El alquiler tiene que ser mayor a cero');
  }
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function money(n: number, currency: RentCurrency): string {
  return `${currency === RentCurrency.USD ? 'US$' : '$'} ${Math.round(n).toLocaleString('es-AR')}`;
}

function pct(factor: number): string {
  const v = (factor - 1) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`;
}
