import { ValueTransformer } from 'typeorm';

/** Postgres devuelve numeric como string; lo convertimos a number en la app. */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : parseFloat(value)),
};
