import { useRef, useState, type CSSProperties } from 'react';
import { uploadWithProgress } from '../api/client';
import { btnLink, btnSecondary, colors } from '../styles';

/** Mismo límite que la API (Supabase gratis no acepta archivos de más de 50 MB). */
const MAX_MB = 50;

interface Props {
  url: string | null;
  setUrl: (url: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}

/** Un video para redes (Reel, TikTok): MP4 o MOV, con barra de progreso y vista previa. */
export default function VideoUploader({ url, setUrl, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!/^video\//.test(file.type) && !/\.(mp4|mov)$/i.test(file.name)) return setError(`"${file.name}" no es un video`);
    if (file.size > MAX_MB * 1024 * 1024) {
      return setError(`El video pesa ${(file.size / 1024 / 1024).toFixed(0)} MB y el máximo es ${MAX_MB} MB. Recortalo o exportalo en menor calidad (1080p alcanza).`);
    }
    setProgress(0);
    onBusyChange(true);
    try {
      const res = await uploadWithProgress<{ url: string }>('/media/videos', file, 'file', setProgress);
      setUrl(res.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  }

  return (
    <div>
      {url ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <video src={url} controls preload="metadata" style={{ width: 200, maxHeight: 300, borderRadius: 8, background: '#000' }} />
          <button type="button" style={{ ...btnLink, color: colors.danger }} onClick={() => setUrl(null)}>
            Quitar video
          </button>
        </div>
      ) : (
        <div style={dropZone}>
          <button type="button" style={btnSecondary} onClick={() => input.current?.click()} disabled={progress !== null}>
            {progress !== null ? `Subiendo… ${Math.round(progress * 100)}%` : 'Elegir video'}
          </button>
          <span style={{ fontSize: 13, color: colors.muted }}>
            MP4 o MOV, hasta {MAX_MB} MB. Para Reels y TikTok conviene vertical (9:16).
          </span>
          {progress !== null && (
            <div style={{ width: '100%', height: 6, background: colors.soft, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${progress * 100}%`, height: '100%', background: colors.primary, transition: 'width .2s' }} />
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: '8px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const dropZone: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: 14, border: '1.5px dashed #cfd6e4', borderRadius: 10, background: '#fafbfd' };
