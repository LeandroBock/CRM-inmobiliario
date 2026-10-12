import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { Public } from '../../auth/presentation/decorators';
import { ConversationService, IncomingMessage } from '../application/conversation.service';

/**
 * Público a propósito: Meta no manda token de usuario. La seguridad es el verify token (GET)
 * y la firma HMAC X-Hub-Signature-256 (POST). Tampoco se limita por velocidad: el tráfico es de Meta.
 */
@Public()
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly config: ConfigService, private readonly conversation: ConversationService) {}

  /** Verificación inicial del webhook (Meta hace un GET con hub.challenge). */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === this.config.get('WHATSAPP_VERIFY_TOKEN')) {
      this.logger.log('Meta verificó el webhook');
      return res.status(200).send(challenge);
    }
    this.logger.warn('Meta intentó verificar el webhook con otro verify token (revisá WHATSAPP_VERIFY_TOKEN)');
    throw new ForbiddenException();
  }

  /** Mensajes entrantes. Se responde 200 enseguida y se procesa en segundo plano. */
  @Post()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>) {
    this.assertValidSignature(req);

    const body = req.body;
    const messages: IncomingMessage[] =
      body?.entry?.flatMap((e: any) =>
        e.changes?.flatMap((c: any) => (c.value?.messages ?? []).map((m: any) => parseMessage(m, c.value?.contacts?.[0]?.profile?.name))),
      ) ?? [];

    // Sin el contenido ni el teléfono completo: alcanza para saber que llegan.
    const statuses = body?.entry?.flatMap((e: any) => e.changes?.flatMap((c: any) => c.value?.statuses ?? []) ?? []).length ?? 0;
    this.logger.log(`Webhook de WhatsApp: ${messages.length} mensaje(s), ${statuses} estado(s) de entrega`);

    for (const m of messages) {
      // fire-and-forget: no bloqueamos la respuesta a Meta (bajar y transcribir un audio puede tardar)
      this.conversation.handleIncoming(m).catch((err) => this.logger.error(`Error procesando ${m.wamid}: ${err.message}`));
    }
    return { received: true };
  }

  /** Valida X-Hub-Signature-256 con el App Secret (requiere rawBody: true en NestFactory.create). */
  private assertValidSignature(req: RawBodyRequest<Request>) {
    const secret = this.config.getOrThrow<string>('WHATSAPP_APP_SECRET');
    const header = req.header('x-hub-signature-256') ?? '';
    const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody ?? Buffer.alloc(0)).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(
        header
          ? 'Webhook de WhatsApp rechazado: la firma no coincide (WHATSAPP_APP_SECRET no es el "App secret" de esta app de Meta)'
          : 'Webhook de WhatsApp rechazado: llegó sin firma (no viene de Meta)',
      );
      throw new UnauthorizedException('Firma inválida');
    }
  }
}

/** Traduce un mensaje del webhook de Meta. Los tipos que el CRM no procesa llegan como `unsupported`. */
function parseMessage(m: any, name?: string): IncomingMessage {
  const base = { wamid: String(m.id), from: String(m.from), name };
  switch (m.type) {
    case 'text':
      return { ...base, kind: 'text', text: String(m.text?.body ?? '') };
    case 'audio':
      return { ...base, kind: 'audio', mediaId: String(m.audio?.id) };
    case 'image':
      return { ...base, kind: 'image', mediaId: String(m.image?.id), caption: m.image?.caption };
    case 'location':
      return {
        ...base,
        kind: 'location',
        latitude: Number(m.location?.latitude),
        longitude: Number(m.location?.longitude),
        label: [m.location?.name, m.location?.address].filter(Boolean).join(', ') || undefined,
      };
    case 'button': // respuesta a un botón de plantilla: se trata como texto
      return { ...base, kind: 'text', text: String(m.button?.text ?? '') };
    case 'interactive':
      return { ...base, kind: 'text', text: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') };
    default:
      return { ...base, kind: 'unsupported', type: String(m.type) };
  }
}
