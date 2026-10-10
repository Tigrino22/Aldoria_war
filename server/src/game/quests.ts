import {
  BUILDING_KEYS,
  QUESTS,
  RESOURCES,
  UnitKey,
  addUnits,
  emptyUnits,
  normalizeUnits,
  warehouseCapacity,
  type QuestContext,
  type QuestView,
} from '@aldoria/shared';
import type { Db } from '../db';
import { GameError, forbidden } from '../errors';
import { saveVillage, syncVillage } from './village';

export async function loadQuestContext(c: Db, playerId: number): Promise<QuestContext> {
  const villages = (await c.query('SELECT id, buildings FROM villages WHERE owner_id = $1', [playerId])).rows;
  const buildings = Object.fromEntries(BUILDING_KEYS.map((k) => [k, 0])) as QuestContext['buildings'];
  for (const v of villages) for (const k of BUILDING_KEYS) buildings[k] = Math.max(buildings[k], Number(v.buildings?.[k] ?? 0));
  let units = emptyUnits();
  const ids = villages.map((v) => v.id);
  if (ids.length) {
    // Troupes chez elles, en route (le propriétaire est le village d'origine) ou en cours de recrutement.
    for (const r of (await c.query('SELECT units FROM troops WHERE home_village_id = ANY($1)', [ids])).rows) units = addUnits(units, normalizeUnits(r.units));
    for (const r of (await c.query('SELECT units FROM commands WHERE home_village_id = ANY($1) AND NOT processed', [ids])).rows) units = addUnits(units, normalizeUnits(r.units));
    for (const r of (await c.query('SELECT unit, count - delivered AS left FROM recruit_queue WHERE village_id = ANY($1)', [ids])).rows) {
      units = addUnits(units, { ...emptyUnits(), [r.unit as UnitKey]: Number(r.left) });
    }
  }
  const tribe = (await c.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id;
  return { buildings, units, villages: villages.length, hasTribe: !!tribe };
}

export async function listQuests(c: Db, playerId: number): Promise<QuestView[]> {
  const ctx = await loadQuestContext(c, playerId);
  const claimed = new Set((await c.query('SELECT quest_key FROM quest_claims WHERE player_id = $1', [playerId])).rows.map((r) => r.quest_key));
  return QUESTS.map((q) => ({ key: q.key, title: q.title, description: q.description, reward: q.reward, done: q.check(ctx), claimed: claimed.has(q.key) }));
}

/** Récupère la récompense d'une quête terminée dans l'un des villages du joueur, dans la limite de l'entrepôt. */
export async function claimQuest(c: Db, playerId: number, key: string, villageId: number, now: Date) {
  const quest = QUESTS.find((q) => q.key === key);
  if (!quest) throw new GameError('Quête inconnue', 404);
  const village = await syncVillage(c, villageId, now);
  if (village.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const ctx = await loadQuestContext(c, playerId);
  if (!quest.check(ctx)) throw new GameError("Cette quête n'est pas encore accomplie");
  const inserted = await c.query('INSERT INTO quest_claims (player_id, quest_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING quest_key', [playerId, key]);
  if (!inserted.rows.length) throw new GameError('Récompense déjà récupérée');
  const cap = warehouseCapacity(village.buildings.warehouse);
  for (const r of RESOURCES) village[r] = Math.max(village[r], Math.min(cap, village[r] + quest.reward[r]));
  await saveVillage(c, village);
}
