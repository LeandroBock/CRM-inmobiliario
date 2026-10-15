import Anthropic from '@anthropic-ai/sdk';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/** Esquema JSON de la respuesta (salida estructurada de Claude: la respuesta siempre cumple el esquema). */
export type JsonSchema = Record<string, unknown>;

/**
 * Claude para escribir textos de redes. Separado de ContentService para poder reemplazarlo en los tests.
 * Usa LLM_MODEL (el mismo modelo del asistente) o CONTENT_LLM_MODEL si se quiere otro para los textos.
 */
@Injectable()
export class ContentLlm {
  private anthropic?: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = config.get('CONTENT_LLM_MODEL') || config.get('LLM_MODEL', 'claude-sonnet-5-5');
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim());
  }

  /** Se crea al primer uso: sin ANTHROPIC_API_KEY la API arranca igual y solo falla esta función (503). */
  private get client(): Anthropic {
    return (this.anthropic ??= new Anthropic({ apiKey: requiredSetting(this.config, 'ANTHROPIC_API_KEY') }));
  }

  async json<T>(system: string, prompt: string, schema: JsonSchema): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system,
      // Textos cortos: poco razonamiento alcanza y sale más barato y rápido
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new ServiceUnavailableException('La IA no quiso escribir este texto. Probá con otras indicaciones.');
    if (res.stop_reason === 'max_tokens') throw new ServiceUnavailableException('El texto de la IA salió demasiado largo. Probá de nuevo.');
    const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(raw) as T;
  }
}
