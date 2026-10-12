/**
 * Quita las claves con valor undefined. Hace falta antes de Object.assign(entidad, dto):
 * con target ES2022 los campos declarados en la clase del DTO existen aunque el cliente no los mande,
 * y pisarían la entidad en memoria con undefined (null sí se conserva: significa "borrar el dato").
 */
export function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
