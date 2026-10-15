import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';
import Modal from './Modal';

type Action = 'amueblar' | 'mejorar' | 'ordenar' | 'personalizado';

const ACTIONS: { value: Action; label: string; hint: string }[] = [
  { value: 'amueblar', label: '🛋️ Amueblar', hint: 'Agrega muebles y decoración a un ambiente vacío' },
  { value: 'mejorar', label: '☀️ Mejorar luz y colores', hint: 'Más luz natural, colores vivos, cielo despejado' },
  { value: 'ordenar', label: '🧹 Ordenar', hint: 'Saca objetos personales, cables y desorden' },
  { value: 'personalizado', label: '✏️ Otra cosa', hint: 'Contale qué cambiar' },
];

/** Se consulta una sola vez por sesión si la IA de fotos está configurada en la API. */
let configuredPromise: Promise<boolean> | null = null;
function photoAiConfigured(): Promise<boolean> {
  configuredPromise ??= apiFetch<{ configured: boolean }>('/media/photos/ai')
    .then((r) => r.configured)
    .catch(() => {
      configuredPromise = null;
      return false;
    });
  return configuredPromise;
}

interface Props {
  url: string;
  /** Si todavía entra otra foto (si no, solo se puede reemplazar). */
  canAdd: boolean;
  onAdd: (newUrl: string) => void;
  onReplace: (newUrl: string) => void;
  onClose: () => void;
}

/** Editar una foto con IA. El resultado es una foto nueva: se agrega o reemplaza a la original. */
export default function PhotoAiEditor({ url, canAdd, onAdd, onReplace, onClose }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [action, setAction] = useState<Action>('amueblar');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    photoAiConfigured().then(setConfigured);
  }, []);

  async function generate() {
    if (action === 'personalizado' && !instructions.trim()) return setError('Escribí qué querés cambiar');
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<{ url: string }>('/media/photos/ai', {
        method: 'POST',
        body: JSON.stringify({ url, action, instructions: instructions.trim() || undefined }),
      });
      setResult(saved.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Editar foto con IA" onClose={onClose}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        {configured === false ? (
          <p style={{ fontSize: 14 }}>
            La edición de fotos con IA todavía no está configurada: faltan <code>CLOUDFLARE_ACCOUNT_ID</code> y <code>CLOUDFLARE_AI_TOKEN</code> en la API
            (cuenta gratis de Cloudflare, ver README → Fotos con IA).
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <figure style={figure}>
                <img src={url} alt="Original" style={img} />
                <figcaption style={caption}>Original</figcaption>
              </figure>
              <figure style={figure}>
                {result ? <img src={result} alt="Editada con IA" style={img} /> : <div style={{ ...img, ...placeholder }}>{busy ? 'La IA está trabajando… (unos segundos)' : 'Acá aparece la foto editada'}</div>}
                <figcaption style={caption}>Editada con IA</figcaption>
              </figure>
            </div>

            <div role="radiogroup" aria-label="Qué hacer" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 10px' }}>
              {ACTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={action === a.value}
                  title={a.hint}
                  onClick={() => setAction(a.value)}
                  style={{ ...chip, ...(action === a.value ? chipOn : null) }}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <input
              style={input}
              value={instructions}
              maxLength={300}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={action === 'personalizado' ? 'Ej.: pintá las paredes de blanco' : 'Indicaciones (opcional): estilo nórdico, tonos claros…'}
              aria-label="Indicaciones para la IA"
            />
            <small style={{ display: 'block', color: colors.muted, marginTop: 8 }}>
              La foto editada lleva grabada la leyenda "Imagen ilustrativa", para que quien la vea sepa que no es el estado real. La original no se toca.
              Revisá que no haya cambiado ventanas, paredes ni medidas.
            </small>
          </>
        )}
      </div>
      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnLink} onClick={onClose} disabled={busy}>
          Cerrar
        </button>
        {configured !== false && (
          <button type="button" style={{ ...(result ? btnSecondary : btnPrimary), opacity: busy || !configured ? 0.7 : 1 }} onClick={generate} disabled={busy || !configured}>
            {busy ? 'Generando…' : result ? 'Probar de nuevo' : '✨ Generar'}
          </button>
        )}
        {result && !busy && (
          <>
            <button type="button" style={btnSecondary} onClick={() => onReplace(result)}>
              Reemplazar la original
            </button>
            <button type="button" style={{ ...btnPrimary, opacity: canAdd ? 1 : 0.6 }} onClick={() => onAdd(result)} disabled={!canAdd} title={canAdd ? undefined : 'No entran más fotos'}>
              Agregar como foto nueva
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

const figure: CSSProperties = { margin: 0, flex: '1 1 260px', minWidth: 0 };
const img: CSSProperties = { display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: colors.soft, borderRadius: 8 };
const placeholder: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.muted, fontSize: 14, textAlign: 'center', padding: 12 };
const caption: CSSProperties = { fontSize: 12, color: colors.muted, marginTop: 4, textAlign: 'center' };
const chip: CSSProperties = { border: `1px solid ${colors.border}`, background: '#fff', borderRadius: 999, padding: '6px 12px', fontSize: 14, cursor: 'pointer' };
const chipOn: CSSProperties = { borderColor: colors.primary, background: colors.soft, color: colors.primary, fontWeight: 600 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}`, flexWrap: 'wrap' };
