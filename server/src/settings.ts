import { pool } from './db';
import { parseClock, parseWeekdays } from '@aldoria/shared';
import { env } from './env';

/**
 * Réglages du monde modifiables à chaud depuis l'administration. Ils sont enregistrés en base et remplacent la valeur
 * de l'environnement au démarrage. La vitesse du monde et la taille de la carte n'en font pas partie : les changer en
 * cours de partie fausserait les files de construction, les trajets en cours et les coordonnées.
 */
export interface SettingDef {
  key: 'accountManager' | 'npcRevenge' | 'npcWars' | 'npcPlayerWars' | 'npcOffensive' | 'npcOffensiveShare' | 'npcOffensiveHours' | 'npcIntercept' | 'npcAttackMargin' | 'npcRaids' | 'npcRaidsPerThink' | 'npcRaidRadius' | 'npcThinkMinutes' | 'npcRecruitBatch' | 'npcRecruitBatches' | 'npcArmyFirst' | 'npcDifficulty' | 'npcDaily' | 'npcMax' | 'npcTribeMax' | 'npcQuietStart' | 'npcQuietEnd' | 'npcTimezone' | 'crusades' | 'crusadeDays' | 'crusadeTime' | 'crusadeMinutes' | 'crusadeNoticeHours' | 'crusadeGarrison' | 'crusadeRelicBonus' | 'provinces' | 'provinceHoldHours' | 'provinceGarrison1' | 'provinceGarrison2' | 'provinceGarrison3' | 'provinceWall1' | 'provinceWall2' | 'provinceWall3' | 'provinceBonus1' | 'provinceBonus2' | 'provinceBonus3' | 'provinceTreasure1' | 'provinceTreasure2' | 'provinceTreasure3' | 'holyAccess' | 'holyHoldDays' | 'reportsKeepDays' | 'commandsKeepDays';
  label: string;
  help: string;
  type: 'number' | 'integer' | 'text' | 'boolean';
  /** Pour un texte : ce qu'il doit contenir (fuseau horaire par défaut). */
  format?: 'timezone' | 'weekdays' | 'clock';
  min?: number;
  max?: number;
}

export const SETTINGS: SettingDef[] = [
  { key: 'accountManager', label: 'Gestionnaire de compte', help: 'Activé : les joueurs peuvent confier à un pilote automatique la construction et le recrutement de leurs villages, selon leurs modèles. Désactivé : plus rien ne s’exécute automatiquement (les réglages des joueurs sont conservés)', type: 'boolean' },
  { key: 'npcRevenge', label: 'Riposte des PNJ', help: 'Activée : un PNJ attaqué par un joueur lui en veut et contre-attaque pendant 3 jours. Désactivée : il ne riposte plus contre les joueurs (la riposte entre PNJ, les guerres, la défense et les attaques habituelles continuent)', type: 'boolean' },
  { key: 'npcWars', label: 'Guerres entre tribus de PNJ', help: 'Activées : les tribus de PNJ se déclarent la guerre pour quelques jours, se pillent et cherchent à se conquérir. Désactivées : plus de nouvelle guerre ni de frappe contre une tribu ennemie (les rivalités habituelles restent)', type: 'boolean' },
  { key: 'npcPlayerWars', label: 'Guerres contre les tribus de joueurs', help: 'Activées : une tribu de PNJ peut déclarer la guerre à une tribu de joueurs sans provocation (et accepter celle qu’un chef de tribu lui déclare) ; ses membres frappent alors les villages de cette tribu. Désactivées : ces guerres s’arrêtent et aucune nouvelle ne démarre. Sans lien avec la riposte, qui ne concerne que les joueurs qui attaquent un PNJ. Nécessite aussi l’interrupteur des guerres entre PNJ', type: 'boolean' },
  { key: 'npcOffensive', label: 'Offensives des PNJ', help: 'Activées : de temps en temps, un village offensif de PNJ envoie une vraie attaque (une part de son armée) contre un joueur de sa taille, un ennemi de guerre ou une tribu rivale, après l’avoir espionné ; jamais un joueur sous protection débutant ni pendant les heures calmes. Désactivées : les PNJ reviennent aux pillages habituels', type: 'boolean' },
  { key: 'npcOffensiveShare', label: 'Part de l’armée engagée dans une offensive (%)', help: '50 = la moitié des épéistes, cavaliers et béliers du village part ; si cette part ne bat pas la défense espionnée, toute l’armée offensive part à la place, et si même elle ne suffit pas, le PNJ renonce et retentera plus tard', type: 'integer', min: 10, max: 100 },
  { key: 'npcOffensiveHours', label: 'Rythme des offensives (heures de jeu)', help: 'Délai moyen entre deux offensives d’un même PNJ ; un joueur ne subit pas plus d’une offensive par période', type: 'integer', min: 1, max: 168 },
  { key: 'npcIntercept', label: 'Interceptions des PNJ', help: 'Activées : un village de PNJ attaque en chemin les armées hostiles qui passent à 10 cases ou moins de lui (attaques contre sa tribu ou ses alliés, armées de ses ennemis), s’il est sûr de gagner en rase campagne ; jamais contre un joueur sous protection débutant ni pendant les heures calmes. Désactivées : seuls les joueurs interceptent', type: 'boolean' },
  { key: 'npcAttackMargin', label: 'Marge de sécurité des attaques des PNJ (%)', help: '0 = un PNJ attaque dès que son armée bat l’armée espionnée en face ; 30 = il attend d’être 30 % plus fort que la défense estimée (avant : 30)', type: 'integer', min: 0, max: 200 },
  { key: 'npcRaids', label: 'Pillage intensif des PNJ', help: 'Activé : à chaque réflexion, chaque village de PNJ envoie plusieurs petits pillages vers les villages sans défense qu’il connaît (barbares, villages vides des PNJ rivaux ou en guerre), d’après ses propres rapports, et espionne les barbares inconnus. Jamais contre un joueur. Désactivé : un seul pillage par réflexion, comme avant', type: 'boolean' },
  { key: 'npcRaidsPerThink', label: 'Pillages par village et par réflexion', help: 'Nombre maximal de pillages qu’un village de PNJ envoie à chaque réflexion (s’il lui reste des troupes)', type: 'integer', min: 1, max: 30 },
  { key: 'npcRaidRadius', label: 'Rayon du pillage intensif (cases)', help: 'Distance maximale entre le village du PNJ et les villages qu’il pille', type: 'integer', min: 5, max: 60 },
  { key: 'npcThinkMinutes', label: 'Rythme de réflexion des PNJ (minutes)', help: 'Délai moyen entre deux réflexions d’un PNJ à vitesse x1 (entre la moitié et une fois et demie), divisé par la racine de la vitesse du monde : plus court, les PNJ construisent, recrutent et pillent plus souvent', type: 'integer', min: 2, max: 60 },
  { key: 'npcRecruitBatch', label: 'Taille maximale d’un lot de recrutement des PNJ', help: 'Nombre maximal d’unités d’un même type recrutées d’un coup (réduit de moitié tant que c’est trop cher ou trop lourd pour la ferme). Avant : 40', type: 'integer', min: 10, max: 1000 },
  { key: 'npcRecruitBatches', label: 'Lots de recrutement par réflexion', help: 'Nombre de lots (types d’unités différents) qu’un village de PNJ met en file à chaque réflexion, y compris quand une file est déjà en cours mais bientôt vide. Avant : 1, seulement file vide', type: 'integer', min: 1, max: 7 },
  { key: 'npcArmyFirst', label: 'Les PNJ recrutent avant de construire', help: 'Activé : le recrutement passe avant la construction dans l’usage des ressources, pour que l’armée monte plus vite (la ferme et le reste se construisent avec ce qui reste). Désactivé : construction d’abord, comme avant', type: 'boolean' },
  { key: 'npcDifficulty', label: 'Difficulté des PNJ', help: '0,5 = facile, 1 = modérée, 1,5 = difficile', type: 'number', min: 0.25, max: 3 },
  { key: 'npcDaily', label: 'Nouveaux PNJ par jour', help: 'Un PNJ rejoint le monde chaque jour, jusqu’au maximum', type: 'integer', min: 0, max: 20 },
  { key: 'npcMax', label: 'Maximum de PNJ', help: 'Plafond du nombre de PNJ', type: 'integer', min: 0, max: 500 },
  { key: 'npcTribeMax', label: 'Taille maximale d’une tribu de PNJ', help: '0 = les PNJ restent solitaires', type: 'integer', min: 0, max: 20 },
  { key: 'npcQuietStart', label: 'Début des heures calmes (heure)', help: 'Les PNJ ne visent aucun joueur entre ces deux heures', type: 'integer', min: 0, max: 23 },
  { key: 'npcQuietEnd', label: 'Fin des heures calmes (heure)', help: 'Début = fin désactive les heures calmes', type: 'integer', min: 0, max: 23 },
  { key: 'npcTimezone', label: 'Fuseau horaire des heures calmes', help: 'Par exemple Europe/Paris. Sert aussi à l’heure des Croisades', type: 'text' },
  { key: 'crusades', label: 'Croisades', help: 'Activées : une Citadelle est annoncée sur la carte avant chaque croisade, puis ouvre ses portes pour l’assaut aux jours et à l’heure ci-dessous. Désactivées : plus de nouvelle croisade (celle en cours va jusqu’au bout)', type: 'boolean' },
  { key: 'crusadeDays', label: 'Jours des Croisades', help: 'Numéros des jours séparés par des virgules : 0 = dimanche, 1 = lundi … 6 = samedi. Par défaut 3,6 (mercredi et samedi)', type: 'text', format: 'weekdays' },
  { key: 'crusadeTime', label: 'Heure d’ouverture des portes', help: 'Par exemple 20:30, dans le fuseau du monde. Gardez la fin avant le début des heures calmes', type: 'text', format: 'clock' },
  { key: 'crusadeMinutes', label: 'Durée de l’assaut (minutes)', help: 'Temps pendant lequel les portes restent ouvertes : le camp qui tient la bannière à la fermeture gagne', type: 'integer', min: 15, max: 240 },
  { key: 'crusadeNoticeHours', label: 'Annonce de la Citadelle (heures avant)', help: 'La Citadelle apparaît sur la carte ce nombre d’heures avant l’ouverture, pour laisser le temps de s’organiser', type: 'integer', min: 1, max: 168 },
  { key: 'crusadeGarrison', label: 'Garnison de la Citadelle (%)', help: 'Population de la garnison en % de l’armée offensive de la tribu la plus forte du monde (au moins 4 000). 150 = il faut faire tomber la muraille avec des béliers puis enchaîner plusieurs vagues, la Garde regarnissant la Citadelle toutes les 15 minutes', type: 'integer', min: 10, max: 400 },
  { key: 'crusadeRelicBonus', label: 'Relique du vainqueur (% de production)', help: 'Bonus de production de tous les villages du camp vainqueur pendant 7 jours. 0 = relique seulement honorifique', type: 'integer', min: 0, max: 50 },
  { key: 'provinces', label: 'Provinces', help: 'Activées : les provinces et leurs bastions apparaissent sur la carte, se prennent et donnent leur bonus ; la Terre sainte peut être conquise. Désactivées : plus aucun bonus ni prise de bastion (les bastions restent sur la carte, leurs bannières sont gardées)', type: 'boolean' },
  { key: 'provinceHoldHours', label: 'Tenue d’un bastion avant contrôle (heures)', help: 'Temps pendant lequel une tribu doit garder sa bannière sur un bastion, sans interruption, pour contrôler la province et gagner son bonus', type: 'integer', min: 1, max: 168 },
  { key: 'provinceGarrison1', label: 'Garde d’un bastion de niveau 1 (population)', help: 'Garnison neutre des bastions des provinces de niveau 1 (au bord de la carte). Appliquée tout de suite aux bastions sans bannière (leur garde est remise à neuf) et aux mondes créés ensuite', type: 'integer', min: 0, max: 100000 },
  { key: 'provinceGarrison2', label: 'Garde d’un bastion de niveau 2 (population)', help: 'Garnison neutre des bastions des provinces de niveau 2 (à mi-chemin). Appliquée tout de suite aux bastions sans bannière (leur garde est remise à neuf) et aux mondes créés ensuite', type: 'integer', min: 0, max: 100000 },
  { key: 'provinceGarrison3', label: 'Garde d’un bastion de niveau 3 (population)', help: 'Garnison neutre des bastions des provinces de niveau 3 (autour de la Terre sainte). Appliquée tout de suite aux bastions sans bannière (leur garde est remise à neuf) et aux mondes créés ensuite', type: 'integer', min: 0, max: 100000 },
  { key: 'provinceWall1', label: 'Muraille d’un bastion de niveau 1', help: 'Niveau de muraille des bastions de niveau 1 (au bord de la carte), appliqué tout de suite aux bastions sans bannière', type: 'integer', min: 0, max: 20 },
  { key: 'provinceWall2', label: 'Muraille d’un bastion de niveau 2', help: 'Niveau de muraille des bastions de niveau 2 (à mi-chemin), appliqué tout de suite aux bastions sans bannière', type: 'integer', min: 0, max: 20 },
  { key: 'provinceWall3', label: 'Muraille d’un bastion de niveau 3', help: 'Niveau de muraille des bastions de niveau 3 (autour de la Terre sainte), appliqué tout de suite aux bastions sans bannière', type: 'integer', min: 0, max: 20 },
  { key: 'provinceBonus1', label: 'Bonus d’une province de niveau 1 (%)', help: 'Production de la ressource de la province, vitesse de recrutement ou vitesse des troupes, en plus pour tous les villages de la tribu qui contrôle une province de niveau 1 (au bord de la carte) ; les provinces s’additionnent', type: 'integer', min: 0, max: 100 },
  { key: 'provinceBonus2', label: 'Bonus d’une province de niveau 2 (%)', help: 'Production de la ressource de la province, vitesse de recrutement ou vitesse des troupes, en plus pour tous les villages de la tribu qui contrôle une province de niveau 2 (à mi-chemin) ; les provinces s’additionnent', type: 'integer', min: 0, max: 100 },
  { key: 'provinceBonus3', label: 'Bonus d’une province de niveau 3 (%)', help: 'Production de la ressource de la province, vitesse de recrutement ou vitesse des troupes, en plus pour tous les villages de la tribu qui contrôle une province de niveau 3 (autour de la Terre sainte) ; les provinces s’additionnent', type: 'integer', min: 0, max: 100 },
  { key: 'provinceTreasure1', label: 'Trésor d’une province de niveau 1 (% de l’entrepôt)', help: 'Quand une tribu prend le contrôle d’une province de niveau 1 (au bord de la carte), chaque membre reçoit dans son inventaire un trésor qui remplit cette part de l’entrepôt d’un village de son choix (une seule fois par tribu et par province). 0 = pas de trésor', type: 'integer', min: 0, max: 100 },
  { key: 'provinceTreasure2', label: 'Trésor d’une province de niveau 2 (% de l’entrepôt)', help: 'Quand une tribu prend le contrôle d’une province de niveau 2 (à mi-chemin), chaque membre reçoit dans son inventaire un trésor qui remplit cette part de l’entrepôt d’un village de son choix (une seule fois par tribu et par province). 0 = pas de trésor', type: 'integer', min: 0, max: 100 },
  { key: 'provinceTreasure3', label: 'Trésor d’une province de niveau 3 (% de l’entrepôt)', help: 'Quand une tribu prend le contrôle d’une province de niveau 3 (autour de la Terre sainte), chaque membre reçoit dans son inventaire un trésor qui remplit cette part de l’entrepôt d’un village de son choix (une seule fois par tribu et par province). 0 = pas de trésor', type: 'integer', min: 0, max: 100 },
  { key: 'holyAccess', label: 'Provinces voisines exigées pour la Terre sainte', help: 'Nombre de provinces bordant la Terre sainte qu’une tribu doit contrôler pour attaquer son Sanctuaire (0 = accès libre). Les éclaireurs y vont toujours', type: 'integer', min: 0, max: 12 },
  { key: 'holyHoldDays', label: 'Tenue de la Terre sainte pour gagner (jours)', help: 'La tribu qui garde sa bannière sur le Sanctuaire ce nombre de jours sans interruption gagne le monde', type: 'integer', min: 1, max: 30 },
  { key: 'reportsKeepDays', label: 'Durée de conservation des rapports (jours)', help: 'Les rapports des joueurs plus anciens sont supprimés chaque heure, sauf ceux qu’ils ont archivés. 0 = tout garder', type: 'integer', min: 0, max: 365 },
  { key: 'commandsKeepDays', label: 'Durée de conservation des mouvements terminés (jours)', help: 'Attaques, renforts et retours arrivés depuis plus longtemps sont effacés de la base chaque heure (les rapports restent). Au moins 4 jours : les PNJ s’en servent pour leurs rancunes', type: 'integer', min: 4, max: 60 },
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
    if (def.format === 'weekdays') return parseWeekdays(text) ? { value: parseWeekdays(text)!.join(',') } : { error: `${def.label} : numéros de jours de 0 à 6 séparés par des virgules` };
    if (def.format === 'clock') return parseClock(text) !== null ? { value: text.replace('h', ':') } : { error: `${def.label} : heure attendue, par exemple 20:30` };
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
