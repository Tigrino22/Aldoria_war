import { Capacitor } from '@capacitor/core';

/** Vrai quand le jeu tourne dans l'application iOS / Android (et non dans un navigateur). */
export const IS_NATIVE = Capacitor.isNativePlatform();

/**
 * Adresse du serveur de jeu. Dans le navigateur, le client est servi par le même domaine que l'API :
 * on laisse vide. Dans l'application mobile, les pages sont embarquées sur le téléphone, il faut donc
 * l'adresse complète du serveur, fixée au moment du build (VITE_API_URL=https://jeu.exemple.fr).
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Adresse du canal temps réel, dérivée de l'adresse de l'API. */
export function wsUrl(path: string): string {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}
