import { pool } from './db';
import { env } from './env';

/**
 * Réglages du monde modifiables à chaud depuis l'administration. Ils sont enregistrés en base et remplacent la valeur
 * de l'environnement au démarrage. La vitesse du monde et la taille de la carte n'en font pas partie : les changer en
 * cours de partie fausserait les files de construction, les trajets en cours et les coordonnées.
 */
export interface SettingDef {
  key: 'accountManager' | 'npcRevenge' | 'npcWars' | 'npcPlayerWars' | 'npcOffensive' | 'npcOffensiveShare' | 'npcOffensiveHours' | 'npcDifficulty' | 'npcDaily' | 'npcMax' | 'npcTribeMax' | 'npcQuietStart' | 'npcQuietEnd' | 'npcTimezone';
  label: string;
  help: string;
  type: 'number' | 'integer' | 'text' | 'boolean';
  min?: number;
  max?: number;
}

export const SETTINGS: SettingDef[] = [
  { key: 'accountManager', label: 'Gestionnaire de compte', help: 'Activé : les joueurs peuvent confier à un pilote automatique la construction et le recrutement de leurs villages, selon leurs modèles. Désactivé : plus rien ne s’exécute automatiquement (les réglages des joueurs sont conservés)', type: 'boolean' },
  { key: 'npcRevenge', label: 'Riposte des PNJ', help: 'Activée : un PNJ attaqué par un joueur lui en veut et contre-attaque pendant 3 jours. Désactivée : il ne riposte plus contre les joueurs (la riposte entre PNJ, les guerres, la défense et les attaques habituelles continuent)', type: 'boolean' },
  { key: 'npcWars', label: 'Guerres entre tribus de PNJ', help: 'Activées : les tribus de PNJ se déclarent la guerre pour quelques jours, se pillent et cherchent à se conquérir. Désactivées : plus de nouvelle guerre ni de frappe contre une tribu ennemie (les rivalités habituelles restent)', type: 'boolean' },
  { key: 'npcPlayerWars', label: 'Guerres contre les tribus de joueurs', help: 'Activées : une tribu de PNJ peut déclarer la guerre à une tribu de joueurs sans provocation (et accepter celle qu’un chef de tribu lui déclare) ; ses membres frappent alors les villages de cette tribu. Désactivées : ces guerres s’arrêtent et aucune nouvelle ne démarre. Sans lien avec la riposte, qui ne concerne que les joueurs qui attaquent un PNJ. Nécessite aussi l’interrupteur des guerres entre PNJ', type: 'boolean' },
  { key: 'npcOffensive', label: 'Offensives des PNJ', help: 'Activées : de temps en temps, un village offensif de PNJ envoie une vraie attaque (une part de son armée) contre un joueur de sa taille, un ennemi de guerre ou une tribu rivale, après l’avoir espionné ; jamais un joueur sous protection débutant ni pendant les heures calmes. Désactivées : les PNJ reviennent aux pillages habituels', type: 'boolean' },
  { key: 'npcOffensiveShare', label: 'Part de l’armée engagée dans une offensive (%)', help: '50 = la moitié des épéistes, cavaliers et béliers du village part ; l’offensive est annulée si cette part ne bat pas la défense espionnée', type: 'integer', min: 10, max: 100 },
  { key: 'npcOffensiveHours', label: 'Rythme des offensives (heures de jeu)', help: 'Délai moyen entre deux offensives d’un même PNJ ; un joueur ne subit pas plus d’une offensive par période', type: 'integer', min: 1, max: 168 },
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
  if (def.type === 'boolean') {
    const text = String(raw ?? '').trim().toLowerCase();
    if (['1', 'true', 'oui', 'on'].includes(text)) return { value: 1 };
    if (['0', 'false', 'non', 'off'].includes(text)) return { value: 0 };
    return { error: `${def.label} : activé ou désactivé attendu` };
  }
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
