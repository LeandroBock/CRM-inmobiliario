import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser } from '../../auth/presentation/decorators';
import { LeadAssignmentService } from '../application/lead-assignment.service';
import { LeadsService } from '../application/leads.service';
import { AssignLeadDto, CreateLeadWithAssigneeDto, LeadQuery, UpdateLeadDto } from './lead.dto';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly assignment: LeadAssignmentService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadWithAssigneeDto, @CurrentUser() user: AuthUser) {
    return this.leads.create(dto, user);
  }

  /** Filtros: stage, temperature, q, assignedTo (me | none | id de asesor). Ordenado por puntaje (mayor primero). */
  @Get()
  findAll(@Query() query: LeadQuery, @CurrentUser() user: AuthUser) {
    return this.leads.findAll({ ...query, currentUserId: user.id });
  }

  /** Asigna el lead a un asesor (userId) o lo deja sin asignar (null). */
  @Patch(':id/assign')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignLeadDto, @CurrentUser() user: AuthUser) {
    await this.assignment.assign(id, dto.userId ?? null, user);
    return this.leads.findOne(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.findOne(id);
  }

  @Get(':id/chats')
  chats(@Param('id', ParseUUIDPipe) id: string, @Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.leads.chatHistory(id, limit);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.leads.remove(id);
  }
}
