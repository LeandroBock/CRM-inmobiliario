import { apiFetch } from './client';

export interface TeamMember {
  id: string;
  fullName: string;
  role: 'admin' | 'agent';
}

let cache: Promise<TeamMember[]> | null = null;

/** Asesores activos. Se pide una vez por sesión; `refresh` después de crear o editar usuarios. */
export function getTeam(refresh = false): Promise<TeamMember[]> {
  if (!cache || refresh) {
    cache = apiFetch<TeamMember[]>('/users/team').catch((e) => {
      cache = null; // que el próximo intento vuelva a pedirlo
      throw e;
    });
  }
  return cache;
}
