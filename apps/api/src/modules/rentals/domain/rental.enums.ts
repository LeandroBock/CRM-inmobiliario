/** Enums de alquileres en un archivo sin imports (ver property.enums.ts: evita undefined en imports circulares). */

/** Cómo se actualiza el alquiler. Desde el DNU 70/2023 se pacta libremente en cada contrato. */
export enum AdjustmentIndex {
  /** Índice para Contratos de Locación (BCRA, diario). */
  ICL = 'icl',
  /** Índice de Precios al Consumidor (INDEC, mensual). */
  IPC = 'ipc',
  /** Porcentaje fijo pactado por período. */
  FIJO = 'fijo',
  /** Sin ajuste automático (monto fijo o se pacta en cada ajuste). */
  NINGUNO = 'ninguno',
}

export enum ContractStatus {
  ACTIVO = 'activo',
  FINALIZADO = 'finalizado',
  RESCINDIDO = 'rescindido',
}

export enum RentCurrency {
  ARS = 'ARS',
  USD = 'USD',
}

/** Índices que se descargan solos (BCRA e INDEC). */
export enum IndexCode {
  ICL = 'icl',
  IPC = 'ipc',
}
