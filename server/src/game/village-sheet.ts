import { reportTone, type VillageRelation, type VillageSheet } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { notFound } from '../errors';
import { estimateLoot, pickIntel } from './intel';
import { provinceAt } from './provinces';
import { allyTribeIdsOf } from './tribe-alliances';

type Q = Pick<Db, 'query'>;

/** Nombre de rapports du joueur montrés sur la fiche. */
export const SHEET_REPORTS = 15;

/**
 * Fiche d'un village vue par un joueur : informations publiques (propriétaire, tribu, points, province, conquêtes),
 * puis ce que ce joueur seul sait de lui : ses rapports, ses renseignements et ses mouvements en route.
 */
export async function villageSheet(c: Q, viewerId: number, x: number, y: number, now: Date): Promise<VillageSheet> {
  const v = (
    await c.query(
      `SELECT v.id, v.name, v.x, v.y, v.kind, v.points, v.loyalty, v.owner_id, p.username, p.protection_until,
              t.id AS tribe_id, t.tag, t.name AS tribe_name
       FROM villages v LEFT JOIN players p ON p.id = v.owner_id LEFT JOIN tribes t ON t.id = p.tribe_id
       WHERE v.x = $1 AND v.y = $2`,
      [x, y],
    )
  ).rows[0];
  if (!v) throw notFound('Aucun village à cet endroit');
  const mine = v.owner_id === viewerId;

  // Rapports du joueur où ce village apparaît, d'un côté ou de l'autre (attaque, défense, espionnage, renfort, livraison).
  const reports = (
    await c.query(
      `SELECT id, type, title, read, archived, created_at, data FROM reports
       WHERE player_id = $1 AND $2::text IN (data->'attacker'->'village'->>'id', data->'defender'->'village'->>'id', data->'to'->>'id', data->'from'->>'id')
       ORDER BY created_at DESC, id DESC LIMIT $3`,
      [viewerId, String(v.id), SHEET_REPORTS],
    )
  ).rows;
  // Le renseignement ne vient que des rapports où ce village était la cible.
  const aimed = reports.filter((r) => r.type !== 'defense' && Number(r.data?.defender?.village?.id) === v.id);
  const intel = mine ? null : pickIntel(aimed);

  const movements = (
    await c.query(
      `SELECT cm.id, cm.type, cm.arrive_at, o.name AS from_name FROM commands cm JOIN villages o ON o.id = cm.origin_village_id
       WHERE cm.player_id = $1 AND cm.target_village_id = $2 AND NOT cm.processed AND cm.type IN ('attack', 'support', 'trade')
       ORDER BY cm.arrive_at LIMIT 20`,
      [viewerId, v.id],
    )
  ).rows;

  const conquests = (
    await c.query('SELECT at, conqueror_name, loser_name FROM conquest_log WHERE x = $1 AND y = $2 ORDER BY at DESC LIMIT 10', [v.x, v.y])
  ).rows;

  return {
    id: v.id,
    name: v.name,
    x: v.x,
    y: v.y,
    kind: v.kind,
    points: v.points,
    owner: v.owner_id ? { id: v.owner_id, name: v.username } : null,
    tribe: v.tribe_id ? { id: v.tribe_id, tag: v.tag, name: v.tribe_name } : null,
    relation: await relationOf(c, viewerId, v),
    protected: !!v.protection_until && new Date(v.protection_until) > now,
    province: await provinceAt(c, v.x, v.y),
    loyalty: mine ? Math.floor(v.loyalty) : null,
    intel,
    lootable: mine || v.kind !== 'village' ? null : estimateLoot(aimed, now, env.worldSpeed, intel?.troops ?? null),
    reports: reports.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      read: r.read,
      archived: r.archived,
      createdAt: new Date(r.created_at).toISOString(),
      tone: reportTone(r.type, r.data),
    })),
    movements: movements.map((m) => ({ id: m.id, type: m.type, arriveAt: new Date(m.arrive_at).toISOString(), fromName: m.from_name })),
    conquests: conquests.map((k) => ({ at: new Date(k.at).toISOString(), conqueror: k.conqueror_name, loser: k.loser_name })),
  };
}

async function relationOf(c: Q, viewerId: number, v: { kind: string; owner_id: number | null; tribe_id: number | null }): Promise<VillageRelation> {
  if (v.kind !== 'village') return 'neutral';
  if (!v.owner_id) return 'barbarian';
  if (v.owner_id === viewerId) return 'mine';
  const myTribe = (await c.query('SELECT tribe_id FROM players WHERE id = $1', [viewerId])).rows[0]?.tribe_id ?? null;
  if (!myTribe || !v.tribe_id) return 'other';
  if (myTribe === v.tribe_id) return 'tribe';
  if ((await allyTribeIdsOf(c, myTribe)).includes(v.tribe_id)) return 'ally';
  const war = await c.query(
    `SELECT 1 FROM tribe_wars WHERE ended_at IS NULL AND until > now()
       AND ((declarer_id = $1 AND target_id = $2) OR (declarer_id = $2 AND target_id = $1)) LIMIT 1`,
    [myTribe, v.tribe_id],
  );
  return war.rowCount ? 'war' : 'other';
}
