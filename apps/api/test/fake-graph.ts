import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

/** Graph API de Meta simulada con un servidor HTTP de verdad: se prueba el cliente real (formularios, errores...). */
export class FakeGraph {
  calls: { method: string; path: string; params: Record<string, string> }[] = [];
  /** Próximo pedido que tiene que fallar (como Meta: 400 con error.message / error_user_msg). */
  failNext: { path: RegExp; message: string; userMsg?: string } | null = null;
  /** Cuántas consultas de estado responden IN_PROGRESS antes de FINISHED. */
  pendingPolls = 0;
  delayPublishMs = 0;
  private n = 0;
  private server!: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const url = new URL(req.url!, 'http://x');
        const params = Object.fromEntries(new URLSearchParams(req.method === 'POST' ? body : url.search));
        const path = url.pathname.replace(/^\/v25\.0\//, '');
        this.calls.push({ method: req.method!, path, params });
        const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

        // Token del usuario del sistema: solo sirve para pedir el de la página y la cuenta de Instagram
        if (req.method === 'GET' && path === 'page-456' && ['token-sistema', 'token-pagina'].includes(params.access_token)) {
          if (params.fields === 'access_token') return json(200, { access_token: 'token-pagina', id: 'page-456' });
          if (params.fields === 'instagram_business_account' && params.access_token === 'token-pagina') return json(200, { instagram_business_account: { id: 'ig-123' } });
        }
        if (params.access_token !== 'token-pagina') return json(401, { error: { message: '(#200) If posting to a page, requires a Page access token' } });
        if (this.failNext && this.failNext.path.test(path)) {
          const f = this.failNext;
          this.failNext = null;
          return json(400, { error: { message: f.message, error_user_msg: f.userMsg } });
        }
        const id = () => String(++this.n);
        // Instagram
        if (req.method === 'POST' && path === 'ig-123/media') {
          const kind = params.media_type === 'CAROUSEL' ? 'carrusel' : params.media_type === 'REELS' ? 'reel' : params.is_carousel_item ? 'item' : 'contenedor';
          return json(200, { id: `${kind}-${id()}` });
        }
        if (req.method === 'POST' && path === 'ig-123/media_publish') {
          await new Promise((r) => setTimeout(r, this.delayPublishMs));
          return json(200, { id: `igpost-${id()}` });
        }
        if (req.method === 'GET' && params.fields === 'status_code,status') {
          return json(200, { status_code: this.pendingPolls-- > 0 ? 'IN_PROGRESS' : 'FINISHED' });
        }
        if (req.method === 'GET' && params.fields === 'permalink') return json(200, { permalink: `https://www.instagram.com/p/${path}/` });
        // Facebook
        if (req.method === 'POST' && path === 'page-456/feed') return json(200, { id: `456_${id()}` });
        if (req.method === 'POST' && path === 'page-456/photos') {
          const photo = `foto-${id()}`;
          return json(200, params.published === 'false' ? { id: photo } : { id: photo, post_id: `456_${id()}` });
        }
        if (req.method === 'POST' && path === 'page-456/videos') return json(200, { id: `video-${id()}` });
        // En videos Meta devuelve una ruta relativa
        if (req.method === 'GET' && params.fields === 'permalink_url') return json(200, { permalink_url: path.startsWith('video-') ? `/reel/${path}` : `https://www.facebook.com/${path}` });
        json(404, { error: { message: `Ruta no simulada: ${req.method} ${path}` } });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  reset() {
    this.calls = [];
    this.failNext = null;
    this.pendingPolls = 0;
    this.delayPublishMs = 0;
  }

  /** Pedidos de publicación (sin las consultas de estado ni de links). */
  writes(): Record<string, string>[] {
    return this.calls.filter((c) => c.method === 'POST').map(({ path, params: { access_token: _token, ...rest } }) => ({ path, ...rest }));
  }
}

