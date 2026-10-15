import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch, apiFetchBlob } from '../api/client';
import type { Property } from '../api/properties';
import { TITLE_MAX, listingDescription, listingFields, listingTitle, plain, recommendedPhotos } from '../portal-kit';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';
import { aiConfigured } from './AiAssist';

const PORTALS = [
  { name: 'Zonaprop', url: 'https://www.zonaprop.com.ar' },
  { name: 'Argenprop', url: 'https://www.argenprop.com' },
  { name: 'MercadoLibre Inmuebles', url: 'https://inmuebles.mercadolibre.com.ar' },
];

/** Todo lo necesario para cargar la propiedad a mano en un portal: textos, datos y fotos. */
export default function PortalKit({ property, onClose }: { property: Property; onClose: () => void }) {
  const [title, setTitle] = useState(() => listingTitle(property));
  const [description, setDescription] = useState(() => listingDescription(property));
  const [copied, setCopied] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [ai, setAi] = useState<boolean | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aiConfigured().then(setAi);
  }, []);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setError('El navegador no dejó copiar: seleccioná el texto y copialo a mano.');
    }
  }

  async function downloadZip() {
    setZipping(true);
    setError(null);
    try {
      const blob = await apiFetchBlob(`/properties/${property.id}/photos.zip`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fotos-${property.title.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setZipping(false);
    }
  }

  async function writeWithAi() {
    setAiBusy(true);
    setError(null);
    try {
      const out = await apiFetch<{ title: string; description: string }>('/social/ai/listing', {
        method: 'POST',
        body: JSON.stringify({ propertyId: property.id, instructions: instructions.trim() || undefined }),
      });
      setTitle(plain(out.title));
      setDescription(plain(out.description));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const fields = listingFields(property);
  const photos = property.photoUrls.length;
  const recommended = recommendedPhotos(property);
  const CopyBtn = ({ id, text }: { id: string; text: string }) => (
    <button type="button" style={copyBtn} onClick={() => copy(id, text)} aria-label={`Copiar ${id}`}>
      {copied === id ? '✓ Copiado' : 'Copiar'}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: colors.muted }}>
          Abrí el formulario de publicación del portal ({PORTALS.map((p, i) => (
            <span key={p.name}>
              {i > 0 && ', '}
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.name}
              </a>
            </span>
          ))}) y copiá cada cosa desde acá.
        </p>

        {ai !== false && (
          <div style={aiBox}>
            <input
              style={{ ...input, flex: 1, minWidth: 200, padding: '6px 9px', fontSize: 14 }}
              value={instructions}
              maxLength={500}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Indicaciones (opcional): para inversores, destacá la luz…"
              aria-label="Indicaciones para la IA"
            />
            <button type="button" style={{ ...btnSecondary, padding: '6px 12px', opacity: aiBusy || !ai ? 0.6 : 1 }} disabled={aiBusy || !ai} onClick={writeWithAi}>
              {aiBusy ? 'Escribiendo…' : '✨ Mejorar título y descripción con IA'}
            </button>
          </div>
        )}

        <Block title="Título" extra={<CopyBtn id="título" text={title} />} hint={`${title.length}/${TITLE_MAX} caracteres (el límite más chico es el de MercadoLibre)`} warn={title.length > TITLE_MAX}>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título del aviso" />
        </Block>

        <Block title="Descripción" extra={<CopyBtn id="descripción" text={description} />} hint="Sin teléfonos, emails ni links: los portales los rechazan. Los contactos llegan por el portal.">
          <textarea style={{ ...input, minHeight: 200, resize: 'vertical', lineHeight: 1.45 }} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descripción del aviso" />
        </Block>

        <Block title="Datos" extra={<CopyBtn id="todos los datos" text={fields.map(([k, v]) => `${k}: ${v}`).join('\n')} />}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {fields.map(([k, v, raw]) => (
                <tr key={k} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '6px 8px 6px 0', color: colors.muted, whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ padding: '6px 8px', width: '100%' }}>{v}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <CopyBtn id={k} text={raw} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block
          title="Fotos"
          hint={
            photos < recommended
              ? `Tiene ${photos}. Zonaprop recomienda al menos ${recommended} para este tipo de propiedad: más fotos, más consultas.`
              : `${photos} fotos, numeradas en orden (la 01 es la portada).`
          }
          warn={photos < recommended}
        >
          <button type="button" style={{ ...btnSecondary, opacity: zipping || !photos ? 0.6 : 1 }} disabled={zipping || !photos} onClick={downloadZip}>
            {zipping ? 'Armando el ZIP…' : `Descargar las ${photos} fotos (ZIP)`}
          </button>
        </Block>
      </div>
      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnPrimary} onClick={onClose}>
          Listo
        </button>
      </div>
    </div>
  );
}

function Block({ title, extra, hint, warn, children }: { title: string; extra?: ReactNode; hint?: string; warn?: boolean; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        {extra}
      </div>
      {children}
      {hint && <small style={{ display: 'block', color: warn ? '#c2410c' : colors.muted, marginTop: 4 }}>{hint}</small>}
    </section>
  );
}

const copyBtn: CSSProperties = { ...btnLink, fontSize: 13, whiteSpace: 'nowrap' };
const aiBox: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', border: `1px dashed ${colors.border}`, borderRadius: 8, padding: 10, marginBottom: 16, background: '#fbfaff' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
