import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { PHOTO_STORAGE, PhotoStorage } from '../../media/domain/photo-storage.port';
import { Property } from '../domain/property.entity';
import { PropertiesService } from './properties.service';

export interface SheetOptions {
  /** Fotos en orden (la primera es la portada). Solo fotos subidas al CRM. Por defecto, las 7 primeras. */
  photoUrls?: string[];
  agencyName?: string;
  /** Línea de contacto (WhatsApp, teléfono, email). */
  contact?: string;
  brandColor?: string;
  logoUrl?: string | null;
  showAddress?: boolean;
  showPrice?: boolean;
  /** Referencia en pesos debajo del precio en dólares. */
  showArs?: boolean;
}

export const MAX_SHEET_PHOTOS = 7;

const A4 = { w: 595.28, h: 841.89 };
const M = 36; // margen
const W = A4.w - M * 2;
const GRAY = '#5f6b7a';
const DARK = '#1f2937';
const LIGHT = '#f3f5f9';

const TYPES: Record<string, string> = {
  departamento: 'Departamento',
  casa: 'Casa',
  ph: 'PH',
  terreno: 'Terreno',
  local: 'Local',
  oficina: 'Oficina',
  cochera: 'Cochera',
};
const FX: Record<string, string> = { blue: 'dólar blue', oficial: 'dólar oficial', mep: 'dólar MEP', ccl: 'dólar CCL' };

/** Ficha de la propiedad en PDF (A4): portada con foto y datos, y una segunda hoja con más fotos. */
@Injectable()
export class PropertySheetService {
  constructor(
    private readonly properties: PropertiesService,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {}

  async build(id: string, opts: SheetOptions = {}): Promise<{ pdf: Buffer; fileName: string }> {
    const p = await this.properties.findOne(id);
    const color = /^#[0-9a-f]{6}$/i.test(opts.brandColor ?? '') ? opts.brandColor! : '#2f5bea';
    const urls = (opts.photoUrls ?? p.photoUrls).slice(0, MAX_SHEET_PHOTOS);
    const photos = (await Promise.all(urls.map((u) => this.image(u)))).filter((b): b is Buffer => b !== null);
    if (opts.photoUrls?.length && !photos.length) throw new BadRequestException('Ninguna de las fotos elegidas está subida al CRM');
    const logo = opts.logoUrl ? await this.image(opts.logoUrl, 400) : null;

    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: latin(p.title), Author: latin(opts.agencyName ?? '') } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const agency = latin(opts.agencyName?.trim() ?? '');
    const contact = latin(opts.contact?.trim() ?? '');
    const header = (small: boolean) => {
      const h = small ? 44 : 64;
      doc.rect(0, 0, A4.w, h).fill(color);
      let x = M;
      if (logo) {
        const size = h - 16;
        doc.roundedRect(x, 8, size, size, 6).fill('#ffffff');
        doc.image(logo, x + 3, 11, { fit: [size - 6, size - 6], align: 'center', valign: 'center' });
        x += size + 12;
      }
      if (agency) doc.font('Helvetica-Bold').fontSize(small ? 13 : 18).fillColor('#ffffff').text(agency, x, h / 2 - (small ? 7 : 10), { width: W - (x - M) - 120, lineBreak: false, ellipsis: true });
      const op = p.operation === 'alquiler' ? 'EN ALQUILER' : 'EN VENTA';
      doc.font('Helvetica-Bold').fontSize(small ? 10 : 12).fillColor('#ffffff').text(op, A4.w - M - 120, h / 2 - 6, { width: 120, align: 'right' });
      return h;
    };
    const footer = () => {
      doc.moveTo(M, A4.h - 52).lineTo(A4.w - M, A4.h - 52).lineWidth(0.5).strokeColor('#d6dbe4').stroke();
      if (contact) doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(contact, M, A4.h - 44, { width: W, align: 'center', lineBreak: false });
      const today = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
        `Los datos, el precio y las fotos son informativos y pueden cambiar sin aviso. No constituye una oferta. Ficha generada el ${today}.`,
        M,
        A4.h - 26,
        { width: W, align: 'center', lineBreak: false },
      );
    };

    // ---------- Hoja 1: portada y datos
    let y = header(false) + 14;
    if (photos[0]) {
      const coverH = 290;
      doc.image(await cover(photos[0], W, coverH), M, y, { width: W, height: coverH });
      y += coverH + 16;
    }
    doc.font('Helvetica-Bold').fontSize(20).fillColor(DARK).text(latin(p.title), M, y, { width: W });
    y = doc.y + 4;
    const where = [TYPES[p.type] ?? p.type, [p.neighborhood, p.city].filter(Boolean).join(', ')].join(' · ');
    doc.font('Helvetica').fontSize(11.5).fillColor(GRAY).text(latin(where), M, y, { width: W });
    if (opts.showAddress) doc.text(latin(`${p.address}, ${p.city}, ${p.province}`), { width: W });
    y = doc.y + 10;

    if (opts.showPrice !== false) {
      doc.font('Helvetica-Bold').fontSize(24).fillColor(color).text(`US$ ${thousands(p.priceUsd)}`, M, y, { width: W });
      y = doc.y + 2;
      if (opts.showArs && p.priceArs) {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Referencia en pesos: $ ${thousands(p.priceArs)} (${FX[p.fxSource] ?? p.fxSource} del ${formatDate(p.fxRateDate)})`, M, y, { width: W });
        y = doc.y;
      }
      y += 10;
    }

    y = facts(doc, p, y);

    if (p.amenities?.length) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text('Comodidades: ', M, y, { continued: true, width: W });
      doc.font('Helvetica').fillColor(DARK).text(latin(p.amenities.join(' · ')));
      y = doc.y + 8;
    }
    const desc = latin(p.description?.trim() ?? '');
    const room = A4.h - 64 - y;
    if (desc && room > 40) {
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(desc, M, y, { width: W, height: room, ellipsis: true, lineGap: 2 });
    }
    footer();

    // ---------- Hoja 2: más fotos (2 columnas)
    const rest = photos.slice(1);
    if (rest.length) {
      doc.addPage({ size: 'A4', margin: 0 });
      let top = header(true) + 14;
      doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text(latin(p.title), M, top, { width: W, lineBreak: false, ellipsis: true });
      top = doc.y + 10;
      const gap = 10;
      const cols = rest.length === 1 ? 1 : 2;
      const cw = (W - gap * (cols - 1)) / cols;
      const rows = Math.ceil(rest.length / cols);
      const ch = Math.min(cols === 1 ? 420 : 230, (A4.h - 70 - top - gap * (rows - 1)) / rows);
      for (const [i, img] of rest.entries()) {
        const cx = M + (i % cols) * (cw + gap);
        const cy = top + Math.floor(i / cols) * (ch + gap);
        doc.image(await cover(img, cw, ch), cx, cy, { width: cw, height: ch });
      }
      footer();
    }

    doc.end();
    const pdf = await done;
    const slug = latin(p.title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    return { pdf, fileName: `ficha-${slug || 'propiedad'}.pdf` };
  }

  /** Foto del almacenamiento del CRM, achicada (no se descargan links de terceros). null si no es nuestra o no existe. */
  private async image(url: string, maxSide = 1400): Promise<Buffer | null> {
    const name = this.storage.fileNameFromUrl(url);
    const data = name ? await this.storage.read(name) : null;
    if (!data) return null;
    return sharp(data).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
  }
}

/** Recorta la foto a la proporción del recuadro (así no se deforma). */
function cover(img: Buffer, w: number, h: number): Promise<Buffer> {
  const scale = 2; // resolución suficiente para imprimir
  return sharp(img).resize(Math.round(w * scale), Math.round(h * scale), { fit: 'cover', withoutEnlargement: false }).jpeg({ quality: 80 }).toBuffer();
}

/** Recuadros con los datos principales (solo los que tienen valor). */
function facts(doc: PDFKit.PDFDocument, p: Property, y: number): number {
  const items: [string, string][] = [];
  if (p.coveredM2) items.push([`${num(p.coveredM2)} m²`, 'cubiertos']);
  if (p.totalM2 && p.totalM2 !== p.coveredM2) items.push([`${num(p.totalM2)} m²`, 'totales']);
  if (p.rooms) items.push([String(p.rooms), p.rooms === 1 ? 'ambiente' : 'ambientes']);
  if (p.bedrooms) items.push([String(p.bedrooms), p.bedrooms === 1 ? 'dormitorio' : 'dormitorios']);
  if (p.bathrooms) items.push([String(p.bathrooms), p.bathrooms === 1 ? 'baño' : 'baños']);
  if (p.garageSpots) items.push([String(p.garageSpots), p.garageSpots === 1 ? 'cochera' : 'cocheras']);
  if (p.ageYears != null) items.push(p.ageYears === 0 ? ['A estrenar', ''] : [`${p.ageYears} años`, 'antigüedad']);
  if (!items.length) return y;
  const cols = 4;
  const gap = 8;
  const bw = (W - gap * (cols - 1)) / cols;
  const bh = 46;
  items.forEach(([value, label], i) => {
    const x = M + (i % cols) * (bw + gap);
    const by = y + Math.floor(i / cols) * (bh + gap);
    doc.roundedRect(x, by, bw, bh, 6).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(DARK).text(value, x, by + (label ? 8 : 15), { width: bw, align: 'center', lineBreak: false });
    if (label) doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(label, x, by + 28, { width: bw, align: 'center', lineBreak: false });
  });
  return y + Math.ceil(items.length / cols) * (bh + gap) + 6;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
const thousands = (n: number) => Math.round(n).toLocaleString('es-AR');
function formatDate(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

/**
 * Las fuentes estándar del PDF (Helvetica) solo tienen caracteres latinos: los emojis y otros símbolos
 * saldrían como basura, así que se sacan. Se conservan tildes, ñ, ², °, €, comillas, guiones, etc.
 */
export function latin(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\n\t\x20-\x7E -ÿ€]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
