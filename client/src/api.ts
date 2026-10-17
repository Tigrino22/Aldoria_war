import { API_BASE } from './config';

let TOKEN_KEY = 'aldoria.token';
/** Monde visé par les routes d'administration (en-tête x-world), choisi dans le tableau de bord. */
let adminWorld: number | null = null;

/** Le tableau de bord garde sa propre session (à côté de celle du jeu) et choisit le monde qu'il administre. */
export function configureApi(opts: { tokenKey?: string; world?: number | null }) {
  if (opts.tokenKey) TOKEN_KEY = opts.tokenKey;
  if (opts.world !== undefined) adminWorld = opts.world;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (adminWorld !== null) headers['x-world'] = String(adminWorld);
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Erreur ${res.status}`, res.status);
  return data as T;
}
