import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import { COPY_TONES, type CopyTone } from '../api/social';
import { btnLink, btnSecondary, colors, input } from '../styles';

/** Se consulta una sola vez por sesión si Claude está configurado en la API. */
let configuredPromise: Promise<boolean> | null = null;
function aiConfigured(): Promise<boolean> {
  configuredPromise ??= apiFetch<{ configured: boolean }>('/social/ai')
    .then((r) => r.configured)
    .catch(() => {
      configuredPromise = null; // si falló la red, se vuelve a preguntar la próxima vez
      return false;
    });
  return configuredPromise;
}

export interface AiRequest {
  rewrite: boolean;
  tone: CopyTone;
  instructions: string;
}

interface Props {
  /** Hay texto escrito: se ofrece "Reescribir" además de "Escribir de nuevo". */
  canRewrite?: boolean;
  /** Motivo por el que todavía no se puede usar (p. ej. "Elegí una propiedad"). */
  blockedReason?: string | null;
  run: (req: AiRequest) => Promise<void>;
  /** Vuelve al texto anterior a la última sugerencia. */
  onUndo?: (() => void) | null;
}

/** Barra de "Escribir con IA": tono, indicaciones opcionales y los botones. */
export default function AiAssist({ canRewrite = false, blockedReason = null, run, onUndo = null }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tone, setTone] = useState<CopyTone>('cercano');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aiConfigured().then(setConfigured);
  }, []);

  async function go(rewrite: boolean) {
    setBusy(true);
    setError(null);
    try {
      await run({ rewrite, tone, instructions: instructions.trim() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (configured === false) {
    return (
      <div style={{ ...box, color: colors.muted, fontSize: 13 }}>
        ✨ Escribir con IA: falta configurar Claude (ANTHROPIC_API_KEY en la API). Mientras tanto podés usar el texto sugerido con los datos de la propiedad.
      </div>
    );
  }

  const disabled = busy || configured === null || Boolean(blockedReason);
  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...input, width: 140, padding: '6px 9px', fontSize: 14 }} value={tone} onChange={(e) => setTone(e.target.value as CopyTone)} aria-label="Tono">
          {COPY_TONES.map((t) => (
            <option key={t.value} value={t.value}>
              Tono: {t.label}
            </option>
          ))}
        </select>
        <input
          style={{ ...input, flex: 1, minWidth: 200, padding: '6px 9px', fontSize: 14 }}
          value={instructions}
          maxLength={500}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={canRewrite ? 'Indicaciones (opcional): más corto, destacá el balcón…' : 'Indicaciones (opcional): destacá la luz, para inversores…'}
          aria-label="Indicaciones para la IA"
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        {canRewrite && (
          <button type="button" style={{ ...btnSecondary, padding: '6px 12px', opacity: disabled ? 0.6 : 1 }} disabled={disabled} onClick={() => go(true)}>
            ✨ Reescribir este texto
          </button>
        )}
        <button type="button" style={{ ...btnSecondary, padding: '6px 12px', opacity: disabled ? 0.6 : 1 }} disabled={disabled} onClick={() => go(false)}>
          ✨ {canRewrite ? 'Escribir uno nuevo' : 'Escribir con IA'}
        </button>
        {onUndo && !busy && (
          <button type="button" style={btnLink} onClick={onUndo}>
            Deshacer
          </button>
        )}
        <small role="status" style={{ color: error ? colors.danger : colors.muted, fontSize: 13 }}>
          {busy ? 'Escribiendo…' : (error ?? blockedReason ?? 'Revisá el texto antes de publicar: la IA puede equivocarse.')}
        </small>
      </div>
    </div>
  );
}

const box: CSSProperties = { border: `1px dashed ${colors.border}`, borderRadius: 8, padding: 10, marginBottom: 8, background: '#fbfaff' };
