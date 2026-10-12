import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/** Un turno de la conversación: texto, o texto + fotos del cliente (bloques `image` en base64). */
export type LlmMessage = Anthropic.MessageParam;

export interface LlmToolCall {
  name: 'update_lead_profile' | 'schedule_visit' | 'handoff_to_agent';
  input: Record<string, any>;
}

export interface LlmReply {
  text: string;
  toolCalls: LlmToolCall[];
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_lead_profile',
    description: 'Registra datos de búsqueda que el cliente mencionó en el chat.',
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        operation: { type: 'string', enum: ['venta', 'alquiler'] },
        budget_max_usd: { type: 'number' },
        neighborhoods: { type: 'array', items: { type: 'string' } },
        min_rooms: { type: 'integer' },
        needs_garage: { type: 'boolean' },
        urgency: { type: 'number', description: '0 (sin apuro) a 1 (urgente)' },
      },
    },
  },
  {
    name: 'schedule_visit',
    description: 'Agenda una visita cuando el cliente confirmó propiedad, día y horario.',
    input_schema: {
      type: 'object',
      properties: {
        property_id: { type: 'string' },
        start_iso: { type: 'string', description: 'Fecha y hora ISO 8601 con offset -03:00' },
      },
      required: ['property_id', 'start_iso'],
    },
  },
  {
    name: 'handoff_to_agent',
    description:
      'Deriva la conversación a un asesor humano: pausa al asistente y avisa al equipo. Usala cuando el cliente pida ' +
      'negociar precio, temas legales, reclamos, hablar con una persona, o cuando no puedas ayudarlo.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Motivo en una frase, para el asesor' } },
      required: ['reason'],
    },
  },
];

@Injectable()
export class LlmClient {
  private anthropic?: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = config.get('LLM_MODEL', 'claude-sonnet-5-5');
  }

  /** Sin ANTHROPIC_API_KEY el asistente queda apagado: los mensajes de WhatsApp los contesta un asesor desde el CRM. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim());
  }

  /** Se crea al primer uso: sin ANTHROPIC_API_KEY la API arranca igual y solo falla esta función. */
  private get client(): Anthropic {
    return (this.anthropic ??= new Anthropic({ apiKey: requiredSetting(this.config, 'ANTHROPIC_API_KEY') }));
  }

  async reply(system: string, history: LlmMessage[]): Promise<LlmReply> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      system,
      tools: TOOLS,
      messages: history,
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ name: b.name as LlmToolCall['name'], input: b.input as Record<string, any> }));

    return { text, toolCalls };
  }
}
