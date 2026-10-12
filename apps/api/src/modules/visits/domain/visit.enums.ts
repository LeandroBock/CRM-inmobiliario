/** Archivo sin imports a propósito (ver property.enums.ts). */
export enum VisitStatus {
  /** La pidió el asistente o se cargó sin confirmar: un asesor tiene que confirmarla. */
  PENDIENTE = 'pendiente',
  CONFIRMADA = 'confirmada',
  REALIZADA = 'realizada',
  CANCELADA = 'cancelada',
}

export enum VisitSource {
  ASISTENTE = 'asistente',
  ASESOR = 'asesor',
}
