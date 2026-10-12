import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsEnum } from 'class-validator';
import { Repository } from 'typeorm';
import { MatchingService } from '../application/matching.service';
import { MatchFeedback, MatchScore } from '../domain/match-score.entity';

class FeedbackDto {
  @IsEnum(MatchFeedback) feedback: MatchFeedback;
}

@Controller('lead-engine')
export class LeadEngineController {
  constructor(
    private readonly matching: MatchingService,
    @InjectRepository(MatchScore) private readonly matches: Repository<MatchScore>,
  ) {}

  /** Matches ya calculados del lead, con la propiedad incluida. No recalcula. */
  @Get('leads/:id/matches')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.matching.findForLead(id);
  }

  /** Recalcula el top de propiedades ideales para un lead. */
  @Post('leads/:id/match')
  match(@Param('id', ParseUUIDPipe) id: string) {
    return this.matching.matchLead(id);
  }

  /** Recalcula puntaje (0-100) y temperatura del lead. */
  @Post('leads/:id/score')
  score(@Param('id', ParseUUIDPipe) id: string) {
    return this.matching.scoreLead(id);
  }

  /** Feedback del "swipe": me gusta / no me interesa / visitó. Sirve para reajustar pesos. */
  @Patch('matches/:id/feedback')
  async feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedbackDto) {
    const res = await this.matches.update(id, { feedback: dto.feedback });
    if (!res.affected) throw new NotFoundException('Match no encontrado');
    return { ok: true };
  }
}
