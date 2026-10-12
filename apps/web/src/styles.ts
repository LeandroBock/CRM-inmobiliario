import type { CSSProperties } from 'react';

export const colors = {
  primary: '#2f5bea',
  border: '#e3e7ef',
  muted: '#667',
  danger: '#c92a2a',
  surface: '#fff',
  soft: '#eef1f6',
};

export const card: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 20,
};

export const input: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  border: '1px solid #cfd6e4',
  borderRadius: 8,
  fontSize: 15,
  fontFamily: 'inherit',
  background: '#fff',
};

export const btnPrimary: CSSProperties = {
  padding: '9px 16px',
  border: 0,
  borderRadius: 8,
  background: colors.primary,
  color: '#fff',
  fontSize: 14,
  cursor: 'pointer',
};

export const btnSecondary: CSSProperties = {
  padding: '9px 16px',
  border: '1px solid #cfd6e4',
  borderRadius: 8,
  background: '#fff',
  color: '#1f2937',
  fontSize: 14,
  cursor: 'pointer',
};

export const btnLink: CSSProperties = {
  border: 0,
  background: 'none',
  color: colors.primary,
  cursor: 'pointer',
  padding: 0,
  fontSize: 14,
};
