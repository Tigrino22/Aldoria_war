import { pool } from './db';
import { env } from './env';

/**
 * Réglages du monde modifiables à chaud depuis l'administration. Ils sont enregistrés en base et remplacent la valeur
 * de l'environnement au démarrage. La vitesse du monde et la taille de la carte n'en font pas partie : les changer en
 * cours de partie fausserait les files de construction, les trajets en cours et les coordonnées.
 */
export interface SettingDef {
  key: 'npcDifficulty' | 'npcDaily' | 'npcMax' | 'npcTribeMax' | 'npcQuietStart' | 'npcQuietEnd' | 'npcTimezone';
  label: string;
  help: string;
  type: 'number' | 'integer' | 'text';
  min?: number;
  max?: number;
}

export const SETTINGS: SettingDef[] = [
  { key: 'npcDifficulty', label: 'Difficulté des PNJ', help: '0,5 = facile, 1 = modérée, 1,5 = difficile', type: 'number', min: 0.25, max: 3 },
  { key: 'npcDaily', label: 'Nouveaux PNJ par jour', help: 'Un PNJ rejoint le monde chaque jour, jusqu’au maximum', type: 'integer', min: 0, max: 20 },
  { key: 'npcMax', label: 'Maximum de PNJ', help: 'Plafond du nombre de PNJ', type: 'integer', min: 0, max: 500 },
  { key: 'npcTribeMax', label: 'Taille maximale d’une tribu de PNJ', help: '0 = les PNJ restent solitaires', type: 'integer', min: 0, max: 20 },
  { key: 'npcQuietStart', label: 'Début des heures calmes (heure)', help: 'Les PNJ ne visent aucun joueur entre ces deux heures', type: 'integer', min: 0, max: 23 },
  { key: 'npcQuietEnd', label: 'Fin des heures calmes (heure)', help: 'Début = fin désactive les heures calmes', type: 'integer', min: 0, max: 23 },
  { key: 'npcTimezone', label: 'Fuseau horaire des heures calmes', help: 'Par exemple Europe/Paris', type: 'text' },
];

/** Valeur lue dans l'environnement au démarrage, pour pouvoir rétablir le réglage d'origine. */
const defaults = Object.fromEntries(SETTINGS.map((s) => [s.key, env[s.key]])) as Record<SettingDef['key'], number | string>;

export const settingValue = (key: SettingDef['key']) => env[key];
export const settingDefault = (key: SettingDef['key']) => defaults[key];

/** Contrôle et convertit une valeur reçue ; renvoie un message d'erreur en français sinon. */
export function parseSetting(def: SettingDef, raw: unknown): { value: number | string } | { error: string } {
  if (def.type === 'text') {
    const text = String(raw ?? '').trim();
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: text });
    } catch {
      return { error: `${def.label} : fuseau horaire inconnu` };
    }
    return { value: text };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return { error: `${def.label} : nombre attendu` };
  if (def.type === 'integer' && !Number.isInteger(n)) return { error: `${def.label} : nombre entier attendu` };
  if (n < (def.min ?? -Infinity) || n > (def.max ?? Infinity)) return { error: `${def.label} : entre ${def.min} et ${def.max}` };
  return { value: n };
}

function apply(key: SettingDef['key'], value: number | string) {
  (env as unknown as Record<string, number | string>)[key] = value;
}

/** Applique au démarrage les réglages enregistrés en base. */
export async function loadSettings() {
  const { rows } = await pool.query('SELECT key, value FROM world_settings');
  for (const row of rows) {
    const def = SETTINGS.find((s) => s.key === row.key);
    if (!def) continue;
    const parsed = parseSetting(def, row.value);
    if ('value' in parsed) apply(def.key, parsed.value);
  }
}

/** Enregistre et applique des réglages ; `null` rétablit la valeur d'origine. */
export async function saveSettings(values: Partial<Record<SettingDef['key'], unknown>>): Promise<string | null> {
  const todo: [SettingDef, number | string | null][] = [];
  for (const def of SETTINGS) {
    if (!(def.key in values)) continue;
    const raw = values[def.key];
    if (raw === null) {
      todo.push([def, null]);
      continue;
    }
    const parsed = parseSetting(def, raw);
    if ('error' in parsed) return parsed.error;
    todo.push([def, parsed.value]);
  }
  for (const [def, value] of todo) {
    if (value === null) {
      await pool.query('DELETE FROM world_settings WHERE key = $1', [def.key]);
      apply(def.key, defaults[def.key]);
    } else {
      await pool.query(
        `INSERT INTO world_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [def.key, String(value)],
      );
      apply(def.key, value);
    }
  }
  return null;
}
