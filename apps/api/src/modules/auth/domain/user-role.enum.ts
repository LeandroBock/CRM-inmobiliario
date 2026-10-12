/** Archivo sin imports a propósito (ver property.enums.ts: evita enums en undefined por imports circulares). */
export enum UserRole {
  /** Gestiona usuarios y tiene acceso total. */
  ADMIN = 'admin',
  /** Asesor: usa el CRM (propiedades, leads, redes, tasaciones) pero no administra usuarios. */
  AGENT = 'agent',
}
