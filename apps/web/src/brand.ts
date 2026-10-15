import { useEffect, useState } from 'react';

/**
 * Marca de la inmobiliaria (logo, nombre, contacto, color) para reels y fichas.
 * Se recuerda en este navegador para no cargarla cada vez.
 */
const BRAND_KEY = 'crm_reel_brand';

export interface Brand {
  agencyName: string;
  contact: string;
  logoUrl: string | null;
  brandColor: string;
}

const DEFAULT: Brand = { agencyName: '', contact: 'Escribinos por WhatsApp', logoUrl: null, brandColor: '#2f5bea' };

export function loadBrand(): Brand {
  try {
    const b = JSON.parse(localStorage.getItem(BRAND_KEY) ?? '{}');
    return {
      agencyName: b.agencyName ?? DEFAULT.agencyName,
      contact: b.contact ?? DEFAULT.contact,
      logoUrl: b.logoUrl ?? null,
      brandColor: b.brandColor ?? DEFAULT.brandColor,
    };
  } catch {
    return DEFAULT;
  }
}

/** Estado de la marca que se guarda solo al cambiar. */
export function useBrand() {
  const [brand, setBrand] = useState<Brand>(loadBrand);
  useEffect(() => {
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    } catch {
      /* sin storage: se vuelve a cargar la próxima vez */
    }
  }, [brand]);
  return [brand, setBrand] as const;
}
