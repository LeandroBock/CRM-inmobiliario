import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property, PropertyStatus } from '../../properties/domain/property.entity';

/**
 * RAG básico: recupera propiedades relevantes del inventario con filtros SQL/PostGIS
 * y las serializa como contexto. Evolución sugerida: pgvector + embeddings.
 */
@Injectable()
export class InventoryRagService {
  constructor(@InjectRepository(Property) private readonly properties: Repository<Property>) {}

  async retrieve(userMessage: string, limit = 6): Promise<string> {
    const text = userMessage.toLowerCase();

    const qb = this.properties
      .createQueryBuilder('p')
      .where('p.status = :status', { status: PropertyStatus.DISPONIBLE })
      .limit(limit);

    // Presupuesto mencionado en el mensaje: "hasta 120 mil", "120000 dólares", "usd 90.000"
    const budget = this.extractBudgetUsd(text);
    if (budget) qb.andWhere('p.price_usd <= :budget', { budget: budget * 1.1 });

    // Barrios que aparecen nombrados en el mensaje (búsqueda sobre los barrios existentes)
    const hoods = await this.properties
      .createQueryBuilder('p')
      .select('DISTINCT p.neighborhood', 'n')
      .getRawMany<{ n: string }>();
    const mentioned = hoods.map((h) => h.n).filter((n) => text.includes(n.toLowerCase()));
    if (mentioned.length) qb.andWhere('p.neighborhood IN (:...mentioned)', { mentioned });

    if (/alquil/.test(text)) qb.andWhere("p.operation = 'alquiler'");
    else if (/compr|venta|invert/.test(text)) qb.andWhere("p.operation = 'venta'");

    const rows = await qb.orderBy('p.updated_at', 'DESC').getMany();
    return rows.map((p) => this.format(p)).join('\n');
  }

  private format(p: Property): string {
    return (
      `- [id:${p.id}] ${p.title} | ${p.type} en ${p.neighborhood}, ${p.city} | ${p.operation} | ` +
      `USD ${p.priceUsd.toLocaleString('es-AR')} | ${p.coveredM2} m² cubiertos | ${p.rooms} amb., ` +
      `${p.bedrooms} dorm., ${p.bathrooms} baños, cochera: ${p.garageSpots > 0 ? 'sí' : 'no'}` +
      (p.amenities.length ? ` | ${p.amenities.join(', ')}` : '')
    );
  }

  private extractBudgetUsd(text: string): number | null {
    const m = text.match(/(?:hasta|máximo|maximo|presupuesto(?: de)?|usd|u\$s|us\$)?\s*(\d{2,3}(?:[.,]\d{3})+|\d{2,4})\s*(mil|k)?\s*(?:usd|dólares|dolares|u\$s)?/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/[.,]/g, ''));
    if (m[2]) n *= 1000;
    return n >= 5000 ? n : null; // descarta números chicos (ambientes, m², etc.)
  }
}
