import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from 'mediabunny';

/**
 * Reel vertical (1080×1920) armado con las fotos de una propiedad, generado en el navegador (sin servidores pagos).
 * La misma función dibuja la vista previa y cada cuadro del video: lo que se ve es lo que sale.
 */

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
const INTRO = 2.2; // segundos
const OUTRO = 3;
const FADE = 0.6; // fundido entre fotos

export interface ReelSlide {
  imageUrl: string;
  /** Texto abajo de la foto (barrio, ambientes, comodidades...). */
  caption: string;
}

export interface ReelSpec {
  slides: ReelSlide[];
  secondsPerSlide: number;
  /**
   * 'completa': toda la foto, sobre un fondo difuminado (las fotos de propiedades suelen ser horizontales).
   * 'llenar': la foto ocupa toda la pantalla vertical (recorta los costados).
   */
  fit: 'completa' | 'llenar';
  /** Arriba de la portada: "EN VENTA" / "EN ALQUILER". */
  kicker: string;
  title: string;
  /** Etiqueta fija arriba a la derecha (precio). Vacío = sin etiqueta. */
  priceTag: string;
  agencyName: string;
  /** WhatsApp u otra línea de contacto para el cierre. */
  contact: string;
  logoUrl: string | null;
  brandColor: string;
}

export interface LoadedImages {
  slides: HTMLImageElement[];
  logo: HTMLImageElement | null;
}

export function totalDuration(spec: ReelSpec): number {
  return INTRO + spec.slides.length * spec.secondsPerSlide + OUTRO;
}

/** Carga las imágenes con CORS (si el servidor no lo permite, el navegador no deja usarlas en un video). */
export async function loadImages(spec: ReelSpec): Promise<LoadedImages> {
  const load = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No se pudo usar la imagen ${url.split('/').pop()}: si es un link externo, subila al CRM`));
      img.src = url;
    });
  const [slides, logo] = await Promise.all([Promise.all(spec.slides.map((s) => load(s.imageUrl))), spec.logoUrl ? load(spec.logoUrl).catch(() => null) : null]);
  return { slides, logo };
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (p: number) => p * p * (3 - 2 * p);

/** Dibuja la foto según el encuadre elegido, con zoom y desplazamiento suaves ("efecto Ken Burns"). */
function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, variant: number, fit: ReelSpec['fit']) {
  if (fit === 'llenar') return drawCover(ctx, img, progress, variant);
  // Fondo: la misma foto, agrandada, difuminada y oscurecida
  ctx.save();
  ctx.filter = 'blur(36px) brightness(0.55)';
  const bg = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight) * 1.15;
  ctx.drawImage(img, (WIDTH - img.naturalWidth * bg) / 2, (HEIGHT - img.naturalHeight * bg) / 2, img.naturalWidth * bg, img.naturalHeight * bg);
  ctx.restore();
  // Adelante: la foto entera (ancho completo), con un zoom leve
  const zoomIn = variant % 2 === 0;
  const scale = (WIDTH / img.naturalWidth) * (zoomIn ? 1 + 0.08 * progress : 1.08 - 0.08 * progress);
  const w = img.naturalWidth * scale;
  const h = Math.min(img.naturalHeight * scale, HEIGHT);
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2 - 60, w, h);
}

/** La foto cubre todo el cuadro, con zoom y desplazamiento suaves. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, progress: number, variant: number) {
  const zoomIn = variant % 2 === 0;
  const scale = zoomIn ? 1.06 + 0.12 * progress : 1.18 - 0.12 * progress;
  const base = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight) * scale;
  const w = img.naturalWidth * base;
  const h = img.naturalHeight * base;
  const dir = variant % 4 < 2 ? 1 : -1;
  const panX = ((w - WIDTH) / 2) * (dir * (progress - 0.5));
  ctx.drawImage(img, (WIDTH - w) / 2 + panX, (HEIGHT - h) / 2, w, h);
}

/** Corta el texto en renglones que entren en el ancho. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, opts: { weight?: number; align?: CanvasTextAlign; maxWidth?: number; color?: string; shadow?: boolean } = {}): number {
  ctx.font = `${opts.weight ?? 700} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = opts.color ?? '#fff';
  if (opts.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 3;
  }
  const lines = wrap(ctx, text, opts.maxWidth ?? WIDTH - 160);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.18));
  ctx.shadowColor = 'transparent';
  return lines.length * size * 1.18;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Un cuadro del reel en el instante `t` (segundos). */
export function drawFrame(ctx: CanvasRenderingContext2D, spec: ReelSpec, images: LoadedImages, t: number): void {
  const n = spec.slides.length;
  const slidesEnd = INTRO + n * spec.secondsPerSlide;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (t < slidesEnd) {
    // Foto actual (la portada usa la primera), con fundido a la siguiente
    const local = Math.max(0, t - INTRO);
    const i = Math.min(n - 1, Math.floor(local / spec.secondsPerSlide));
    const within = t < INTRO ? 0 : local - i * spec.secondsPerSlide;
    // La primera foto también se ve durante la portada: su movimiento abarca los dos tramos
    drawPhoto(ctx, images.slides[i], i === 0 ? clamp(t / (INTRO + spec.secondsPerSlide)) : clamp(within / spec.secondsPerSlide), i, spec.fit);
    const fadeStart = spec.secondsPerSlide - FADE;
    if (t >= INTRO && within > fadeStart && i < n - 1) {
      ctx.globalAlpha = ease(clamp((within - fadeStart) / FADE));
      drawPhoto(ctx, images.slides[i + 1], 0, i + 1, spec.fit);
      ctx.globalAlpha = 1;
    }

    // Degradados para que el texto se lea sobre cualquier foto
    const top = ctx.createLinearGradient(0, 0, 0, 420);
    top.addColorStop(0, 'rgba(0,0,0,0.45)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, WIDTH, 420);
    const bottom = ctx.createLinearGradient(0, HEIGHT - 760, 0, HEIGHT);
    bottom.addColorStop(0, 'rgba(0,0,0,0)');
    bottom.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, HEIGHT - 760, WIDTH, 760);

    if (t < INTRO) {
      // Portada: oscurece y presenta la propiedad
      const a = ease(clamp(t / 0.6));
      ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.globalAlpha = a;
      ctx.fillStyle = spec.brandColor;
      ctx.font = '800 54px system-ui, sans-serif';
      const kw = ctx.measureText(spec.kicker).width + 64;
      roundRect(ctx, 80, 1180, kw, 92, 46);
      textBlock(ctx, spec.kicker, 112, 1196, 54, { weight: 800 });
      textBlock(ctx, spec.title, 80, 1310, 84, { weight: 800, shadow: true });
      ctx.globalAlpha = 1;
    } else {
      // Texto de cada foto, con fundido
      const caption = spec.slides[i].caption;
      if (caption) {
        ctx.globalAlpha = ease(clamp(within / 0.5)) * (1 - ease(clamp((within - fadeStart) / FADE)));
        textBlock(ctx, caption, 80, HEIGHT - 420, 64, { weight: 700, shadow: true });
        ctx.globalAlpha = 1;
      }
    }

    // Precio fijo arriba a la derecha (desde la primera foto)
    if (spec.priceTag && t >= INTRO * 0.5) {
      ctx.globalAlpha = ease(clamp((t - INTRO * 0.5) / 0.5));
      ctx.font = '800 56px system-ui, sans-serif';
      const pw = ctx.measureText(spec.priceTag).width + 60;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, WIDTH - pw - 60, 110, pw, 96, 20);
      textBlock(ctx, spec.priceTag, WIDTH - 60 - pw / 2, 126, 56, { weight: 800, align: 'center', color: '#111', maxWidth: pw });
      ctx.globalAlpha = 1;
    }
    // Las últimas décimas, fundido al cierre
    if (t > slidesEnd - FADE) {
      ctx.globalAlpha = ease(clamp((t - (slidesEnd - FADE)) / FADE));
      drawOutro(ctx, spec, images);
      ctx.globalAlpha = 1;
    }
  } else {
    drawOutro(ctx, spec, images);
  }
}

function drawOutro(ctx: CanvasRenderingContext2D, spec: ReelSpec, images: LoadedImages) {
  ctx.fillStyle = spec.brandColor;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  let y = 640;
  if (images.logo) {
    const max = 360;
    const s = Math.min(max / images.logo.naturalWidth, max / images.logo.naturalHeight);
    const w = images.logo.naturalWidth * s;
    const h = images.logo.naturalHeight * s;
    ctx.fillStyle = '#fff';
    roundRect(ctx, (WIDTH - w) / 2 - 36, y - 36, w + 72, h + 72, 32);
    ctx.drawImage(images.logo, (WIDTH - w) / 2, y, w, h);
    y += h + 110;
  }
  if (spec.agencyName) y += textBlock(ctx, spec.agencyName, WIDTH / 2, y, 76, { weight: 800, align: 'center' }) + 30;
  if (spec.contact) textBlock(ctx, spec.contact, WIDTH / 2, y, 54, { weight: 600, align: 'center', color: 'rgba(255,255,255,0.92)' });
}

/** Música: recortada al largo del video, con entrada y fundido de salida. */
async function prepareMusic(file: File, duration: number): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const sampleRate = 48000;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.loop = decoded.duration < duration;
    const gain = offline.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.9, 0.4);
    gain.gain.setValueAtTime(0.9, Math.max(0.5, duration - 1.6));
    gain.gain.linearRampToValueAtTime(0, duration);
    src.connect(gain).connect(offline.destination);
    src.start(0);
    return await offline.startRendering();
  } finally {
    void ctx.close();
  }
}

/** ¿El navegador puede generar MP4 (H.264)? Chrome y Edge actualizados sí; Safari reciente también. */
export async function canRenderMp4(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  return (await getFirstEncodableVideoCodec(['avc'], { width: WIDTH, height: HEIGHT })) !== null;
}

/** Genera el MP4. `onProgress` va de 0 a 1. */
export async function renderReel(spec: ReelSpec, music: File | null, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const codec = await getFirstEncodableVideoCodec(['avc'], { width: WIDTH, height: HEIGHT });
  if (!codec) throw new Error('Este navegador no puede generar videos MP4. Usá Chrome o Edge actualizados.');
  const images = await loadImages(spec);
  const duration = totalDuration(spec);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });

  let audio: AudioBufferSource | null = null;
  let musicBuffer: AudioBuffer | null = null;
  if (music) {
    if (!(await canEncodeAudio('aac'))) throw new Error('Este navegador no puede agregar música al video (AAC). Generalo sin música o usá Chrome.');
    musicBuffer = await prepareMusic(music, duration);
    audio = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH });
    output.addAudioTrack(audio);
  }

  await output.start();
  try {
    if (audio && musicBuffer) await audio.add(musicBuffer);
    const frames = Math.round(duration * FPS);
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      drawFrame(ctx, spec, images, f / FPS);
      await video.add(f / FPS, 1 / FPS);
      if (f % 10 === 0) onProgress(f / frames);
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  }
  onProgress(1);
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
}
