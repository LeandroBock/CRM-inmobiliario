import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { apiFetch } from '../api/client';
import { btnLink, btnSecondary, colors, input } from '../styles';
import PhotoAiEditor from './PhotoAiEditor';

/** Mismos límites que la API (MediaController / PropertyDto). */
const MAX_FILE_MB = 15;
const MAX_PHOTOS = 40;
/** Se suben de a pocas para no mandar un request gigante con 20 fotos de celular. */
const BATCH_SIZE = 4;
/** Las fotos de iPhone vienen en HEIC; la API (sharp) no las lee, así que se pasan a JPG acá antes de subir. */
const HEIC_NAME = /\.(heic|heif)$/i;
const isHeic = (f: File) => /^image\/hei[cf]/i.test(f.type) || HEIC_NAME.test(f.name);

/** La librería pesa varios MB: se descarga recién la primera vez que aparece una foto HEIC. */
async function heicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/csp'); // variante sin eval, compatible con la CSP de nginx
  const jpg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  return new File([jpg], `${file.name.replace(HEIC_NAME, '')}.jpg`, { type: 'image/jpeg' });
}

interface Props {
  urls: string[];
  setUrls: Dispatch<SetStateAction<string[]>>;
  /** Avisa al formulario para que no se pueda guardar con fotos a medio subir. */
  onBusyChange: (busy: boolean) => void;
  /** Tope de fotos (por defecto el de propiedades; en redes, 10). */
  max?: number;
  /** Texto debajo de las fotos. */
  footnote?: string;
}

interface UploadedPhoto {
  url: string;
}

export default function PhotoManager({ urls, setUrls, onBusyChange, max = MAX_PHOTOS, footnote }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  /** Foto abierta en el editor con IA. */
  const [aiPhoto, setAiPhoto] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange(pending > 0);
  }, [pending, onBusyChange]);

  async function upload(fileList: FileList | File[]) {
    setError(null);
    const files = Array.from(fileList);
    const problems: string[] = [];
    const valid = files.filter((f) => {
      if (!f.type.startsWith('image/') && !HEIC_NAME.test(f.name)) {
        problems.push(`"${f.name}" no es una imagen`);
        return false;
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        problems.push(`"${f.name}" pesa más de ${MAX_FILE_MB} MB`);
        return false;
      }
      return true;
    });

    const room = max - urls.length - pending;
    if (valid.length > room) {
      problems.push(`Se pueden cargar hasta ${max} fotos; se omitieron ${valid.length - Math.max(0, room)}`);
      valid.splice(Math.max(0, room));
    }
    if (!valid.length) {
      setError(problems.join('. ') || null);
      return;
    }

    setPending((n) => n + valid.length);
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const ready: File[] = [];
      for (const f of batch) {
        if (!isHeic(f)) {
          ready.push(f);
          continue;
        }
        try {
          const jpg = await heicToJpeg(f);
          if (jpg.size > MAX_FILE_MB * 1024 * 1024) problems.push(`"${f.name}" convertida a JPG pesa más de ${MAX_FILE_MB} MB`);
          else ready.push(jpg);
        } catch {
          problems.push(`No pude convertir "${f.name}". Exportala como JPG desde Fotos y probá de nuevo`);
        }
      }
      setPending((n) => n - (batch.length - ready.length));
      if (!ready.length) continue;
      const body = new FormData();
      ready.forEach((f) => body.append('files', f));
      try {
        const saved = await apiFetch<UploadedPhoto[]>('/media/photos', { method: 'POST', body });
        setUrls((prev) => [...prev, ...saved.map((s) => s.url)]);
      } catch (e) {
        problems.push((e as Error).message);
      } finally {
        setPending((n) => n - ready.length);
      }
    }
    if (problems.length) setError(problems.join('. '));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  }

  function addLink() {
    const raw = linkInput.trim();
    if (!raw) return;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    } catch {
      setError('El link tiene que empezar con http:// o https://');
      return;
    }
    if (urls.includes(raw)) {
      setError('Esa foto ya está cargada');
      return;
    }
    if (urls.length + pending >= max) {
      setError(`Se pueden cargar hasta ${max} fotos`);
      return;
    }
    setError(null);
    setUrls((prev) => [...prev, raw]);
    setLinkInput('');
  }

  const move = (from: number, to: number) =>
    setUrls((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const remove = (url: string) => setUrls((prev) => prev.filter((u) => u !== url));

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{ ...dropZone, borderColor: dragging ? colors.primary : '#cfd6e4', background: dragging ? colors.soft : '#fafbfd' }}
      >
        <button type="button" style={btnSecondary} onClick={() => fileInput.current?.click()}>
          Elegir fotos
        </button>
        <span style={{ fontSize: 13, color: colors.muted }}>
          o arrastralas acá (también HEIC de iPhone). Se achican a 1920 px, se pasan a JPG y se les borra la ubicación GPS.
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = ''; // permite volver a elegir el mismo archivo
          }}
        />
      </div>

      {(urls.length > 0 || pending > 0) && (
        <ul style={gridStyle}>
          {urls.map((url, i) => (
            <li key={url} style={tile}>
              <img src={url} alt={`Foto ${i + 1}`} loading="lazy" style={thumb} />
              {i === 0 && <span style={coverBadge}>Portada</span>}
              <button type="button" style={aiBtn} onClick={() => setAiPhoto(url)} title="Editar con IA: amueblar, mejorar la luz, ordenar" aria-label={`Editar foto ${i + 1} con IA`}>
                ✨ IA
              </button>
              <div style={tileActions}>
                <button type="button" style={iconBtn} onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Mover foto ${i + 1} a la izquierda`}>
                  ←
                </button>
                {i !== 0 && (
                  <button type="button" style={{ ...iconBtn, fontSize: 11, padding: '2px 6px' }} onClick={() => move(i, 0)}>
                    Portada
                  </button>
                )}
                <button
                  type="button"
                  style={iconBtn}
                  onClick={() => move(i, i + 1)}
                  disabled={i === urls.length - 1}
                  aria-label={`Mover foto ${i + 1} a la derecha`}
                >
                  →
                </button>
                <button type="button" style={{ ...iconBtn, marginLeft: 'auto', color: colors.danger }} onClick={() => remove(url)} aria-label={`Quitar foto ${i + 1}`}>
                  ✕
                </button>
              </div>
            </li>
          ))}
          {Array.from({ length: pending }, (_, i) => (
            <li key={`pending-${i}`} style={{ ...tile, ...pendingTile }} aria-live="polite">
              Subiendo…
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          style={{ ...input, flex: 1 }}
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // Enter acá agrega el link, no envía el formulario
              addLink();
            }
          }}
          placeholder="…o pegá el link de una foto que ya está en internet"
          aria-label="Link de una foto"
        />
        <button type="button" style={btnSecondary} onClick={addLink}>
          Agregar link
        </button>
      </div>

      {aiPhoto && (
        <PhotoAiEditor
          url={aiPhoto}
          canAdd={urls.length + pending < max}
          onClose={() => setAiPhoto(null)}
          onAdd={(newUrl) => {
            // Queda al lado de la original
            setUrls((prev) => {
              const at = prev.indexOf(aiPhoto);
              const next = [...prev];
              next.splice(at < 0 ? next.length : at + 1, 0, newUrl);
              return next;
            });
            setAiPhoto(null);
          }}
          onReplace={(newUrl) => {
            setUrls((prev) => prev.map((u) => (u === aiPhoto ? newUrl : u)));
            setAiPhoto(null);
          }}
        />
      )}

      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: '8px 0 0' }}>
          {error}{' '}
          <button type="button" style={{ ...btnLink, fontSize: 13 }} onClick={() => setError(null)}>
            Cerrar
          </button>
        </p>
      )}
      <small style={{ display: 'block', color: colors.muted, marginTop: 6 }}>
        {urls.length}/{max} fotos. {footnote ?? 'La primera es la portada (la que se usa en listados y redes).'}
      </small>
    </div>
  );
}

const dropZone: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  padding: 14,
  border: '1.5px dashed',
  borderRadius: 10,
};
const gridStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '12px 0 0',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 10,
};
const tile: CSSProperties = {
  position: 'relative',
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: '#fff',
};
const thumb: CSSProperties = { display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: colors.soft };
const pendingTile: CSSProperties = {
  aspectRatio: '4 / 3',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  color: colors.muted,
  background: colors.soft,
};
const coverBadge: CSSProperties = {
  position: 'absolute',
  top: 6,
  left: 6,
  background: colors.primary,
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  padding: '2px 6px',
};
const aiBtn: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  border: 0,
  background: 'rgba(255,255,255,0.92)',
  borderRadius: 4,
  padding: '2px 7px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const tileActions: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3, padding: 4 };
const iconBtn: CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: '#fff',
  borderRadius: 4,
  padding: '2px 6px',
  fontSize: 13,
  cursor: 'pointer',
};
