import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * Envío de emails por SMTP (Gmail, Google Workspace, Brevo, SES, el servidor del hosting...).
 * Sin SMTP_HOST configurado no manda nada: los avisos siguen apareciendo en el CRM.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  private readonly transport?: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    this.from = config.get<string>('SMTP_FROM') || user || 'crm@localhost';
    if (!host) return;
    const port = Number(config.get('SMTP_PORT') ?? 587);
    this.transport = createTransport({
      host,
      port,
      secure: port === 465, // 465 = TLS directo; 587 = STARTTLS
      auth: user ? { user, pass: config.get<string>('SMTP_PASS') ?? '' } : undefined,
    });
  }

  isConfigured(): boolean {
    return Boolean(this.transport);
  }

  /** Nunca lanza: un email que no sale no puede romper el flujo que generó el aviso. */
  async send(msg: MailMessage): Promise<boolean> {
    if (!this.transport || !msg.to.length) return false;
    try {
      // Cada destinatario recibe su propio email (no ven las direcciones de los demás).
      for (const to of msg.to) await this.transport.sendMail({ from: this.from, to, subject: msg.subject, text: msg.text, html: msg.html });
      return true;
    } catch (err) {
      this.logger.error(`No se pudo enviar el email "${msg.subject}": ${(err as Error).message}`);
      return false;
    }
  }
}
