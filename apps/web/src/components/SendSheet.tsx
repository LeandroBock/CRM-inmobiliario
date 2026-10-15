import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import type { ChatMessage } from '../api/leads';
import { formatUsd, type Paginated, type Property } from '../api/properties';
import { useBrand } from '../brand';
import { btnLink, btnPrimary, colors, input } from '../styles';

interface Props {
  leadId: string;
  /** Propiedades sugeridas para el cliente (matches), que aparecen primero. */
  suggested: Property[];
  onSent: (m: ChatMessage) => void;
  onClose: () => void;
}

/** Elegir una propiedad y mandarle la ficha PDF al cliente por WhatsApp. */
export default function SendSheet({ leadId, suggested, onSent, onClose }: Props) {
  const [all, setAll] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState(suggested[0]?.id ?? '');
  const [caption, setCaption] = useState('');
  const [showPrice, setShowPrice] = useState(true);
  const [showAddress, setShowAddress] = useState(false);
  const [brand] = useBrand();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Paginated<Property>>('/properties?limit=100&status=disponible')
      .then((d) => {
        setAll(d.items);
        setPropertyId((prev) => prev || d.items[0]?.id || '');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const others = all.filter((p) => !suggested.some((s) => s.id === p.id));
  const property = [...suggested, ...all].find((p) => p.id === propertyId);
  useEffect(() => {
    if (property) setCaption(`Te paso la ficha de ${property.title}. Cualquier consulta, escribime.`);
  }, [property?.id]);

  async function send() {
    if (!property) return setError('Elegí una propiedad');
    setSending(true);
    setError(null);
    try {
      const saved = await apiFetch<ChatMessage>(`/leads/${leadId}/messages/sheet`, {
        method: 'POST',
        body: JSON.stringify({
          propertyId,
          caption,
          agencyName: brand.agencyName || undefined,
          contact: brand.contact || undefined,
          brandColor: brand.brandColor,
          logoUrl: brand.logoUrl,
          showPrice,
          showAddress,
        }),
      });
      onSent(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <label style={label} htmlFor="sheet-property">
          Propiedad
        </label>
        <select id="sheet-property" style={input} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          {!suggested.length && !all.length && <option value="">Cargando…</option>}
          {suggested.length > 0 && (
            <optgroup label="Sugeridas para este cliente">
              {suggested.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.neighborhood} · {formatUsd(p.priceUsd)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Otras disponibles">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.neighborhood} · {formatUsd(p.priceUsd)}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <label style={{ ...label, marginTop: 14 }} htmlFor="sheet-caption">
          Mensaje que acompaña al PDF
        </label>
        <textarea id="sheet-caption" style={{ ...input, minHeight: 70, resize: 'vertical' }} maxLength={1024} value={caption} onChange={(e) => setCaption(e.target.value)} />

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
          <label style={check}>
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
            Mostrar precio
          </label>
          <label style={check}>
            <input type="checkbox" checked={showAddress} onChange={(e) => setShowAddress(e.target.checked)} />
            Dirección exacta
          </label>
        </div>
        <small style={{ display: 'block', color: colors.muted, marginTop: 10 }}>
          {brand.agencyName
            ? `Sale con la marca "${brand.agencyName}" y las primeras 7 fotos. Para elegir fotos o cambiar la marca, usá Propiedades → Ficha.`
            : 'Todavía no cargaste la marca (logo, nombre y contacto): configurala en Propiedades → Ficha para que la ficha salga con tus datos.'}
        </small>
      </div>
      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnLink} onClick={onClose} disabled={sending}>
          Cancelar
        </button>
        <button type="button" style={{ ...btnPrimary, opacity: sending || !property ? 0.7 : 1 }} onClick={send} disabled={sending || !property}>
          {sending ? 'Enviando…' : 'Mandar por WhatsApp'}
        </button>
      </div>
    </div>
  );
}

const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 };
const check: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
