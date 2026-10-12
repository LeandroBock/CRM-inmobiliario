import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { colors } from '../styles';

export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Esc cierra el formulario. Se cierra solo con Esc o con Cancelar (no al hacer clic afuera) para no perder datos por error.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlay}>
      <div role="dialog" aria-modal="true" aria-label={title} style={dialog}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  zIndex: 10,
};
const dialog: CSSProperties = {
  width: 'min(780px, 100%)',
  maxHeight: '92vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  borderRadius: 12,
  overflow: 'hidden',
};
