import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WhatsAppClient } from '../src/modules/communication/infrastructure/whatsapp.client';

/** El cliente real de WhatsApp contra un Meta simulado: que el PDF salga como multipart y el documento con su id. */
describe('WhatsApp: documentos', () => {
  let server: Server;
  const calls: { path: string; auth?: string; form?: FormData; json?: any }[] = [];
  let client: WhatsAppClient;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const isForm = req.headers['content-type']?.startsWith('multipart/form-data');
        const call = {
          path: req.url!,
          auth: req.headers.authorization,
          form: isForm ? await new Request('http://x', { method: 'POST', headers: req.headers as Record<string, string>, body }).formData() : undefined,
          json: isForm ? undefined : JSON.parse(body.toString() || '{}'),
        };
        calls.push(call);
        const reply = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        if (call.path.endsWith('/media')) return reply(200, { id: 'media-777' });
        if (call.json?.document?.id === 'malo') return reply(400, { error: { message: '(#131053) Media upload error' } });
        return reply(200, { messages: [{ id: 'wamid.doc.1' }] });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const config = new ConfigService({
      META_GRAPH_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      WHATSAPP_PHONE_NUMBER_ID: 'phone-1',
      WHATSAPP_TOKEN: 'token-wa',
    });
    client = new WhatsAppClient(new HttpService(axios.create()), config);
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('sube el PDF y lo manda como documento', async () => {
    const pdf = Buffer.from('%PDF-1.7 prueba');
    const mediaId = await client.uploadMedia(pdf, 'application/pdf', 'ficha-depto.pdf');
    expect(mediaId).toBe('media-777');
    const up = calls[0];
    expect(up.path).toBe('/v25.0/phone-1/media');
    expect(up.auth).toBe('Bearer token-wa');
    expect(up.form!.get('messaging_product')).toBe('whatsapp');
    expect(up.form!.get('type')).toBe('application/pdf');
    const file = up.form!.get('file') as File;
    expect(file.name).toBe('ficha-depto.pdf');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(pdf);

    expect(await client.sendDocument('5493415550000', mediaId, 'ficha-depto.pdf', 'Te paso la ficha')).toBe('wamid.doc.1');
    expect(calls[1].json).toEqual({
      messaging_product: 'whatsapp',
      to: '5493415550000',
      type: 'document',
      document: { id: 'media-777', filename: 'ficha-depto.pdf', caption: 'Te paso la ficha' },
    });
  });

  it('si Meta lo rechaza, el error trae el motivo', async () => {
    await expect(client.sendDocument('549', 'malo', 'x.pdf')).rejects.toThrow('Media upload error');
  });
});
