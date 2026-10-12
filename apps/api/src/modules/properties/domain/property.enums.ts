/**
 * Enums de propiedades en un archivo SIN imports.
 * Las entidades se referencian entre sí (Property <-> Lead <-> MatchScore...) y esos imports
 * circulares dejan los enums en `undefined` si se leen mientras otro módulo se está cargando.
 * Todo lo que use estos enums en tiempo de definición (decoradores, constantes) debe importarlos de acá.
 */
export enum PropertyType {
  DEPARTAMENTO = 'departamento',
  CASA = 'casa',
  PH = 'ph',
  TERRENO = 'terreno',
  LOCAL = 'local',
  OFICINA = 'oficina',
  COCHERA = 'cochera',
}

export enum OperationType {
  VENTA = 'venta',
  ALQUILER = 'alquiler',
}

export enum PropertyStatus {
  DISPONIBLE = 'disponible',
  RESERVADA = 'reservada',
  VENDIDA = 'vendida',
  PAUSADA = 'pausada',
}

/** Fuente de cotización usada para convertir USD <-> ARS. */
export enum FxSource {
  BLUE = 'blue',
  OFICIAL = 'oficial',
  MEP = 'mep',
  CCL = 'ccl',
}
