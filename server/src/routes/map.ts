import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ARMY_SIGHT, RESOURCES, UNIT_KEYS, armySize, normalizeUnits, populationOf, sightWindow, totalUnits, type MapArmy, type MapMovement, type MapRelations, type MapVillage, type RaidStatus, type RaidTarget } from '@aldoria/shared';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { forbidden } from '../errors';
import { env } from '../env';
import { estimateLoot, pickIntel } from '../game/intel';
import { allyTribeIdsOf } from '../game/tribe-alliances';

export default async function mapRoutes(app: FastifyInstance) {
  app.get('/api/map', async (req) => {
    await requirePlayer(req);
    const q = z
      .object({
        x0: z.coerce.number().int().default(0),
        y0: z.coerce.number().int().default(0),
        x1: z.coerce.number().int().default(1000),
        y1: z.coerce.number().int().default(1000),
      })
      .parse(req.query);
    const { rows } = await pool.query(
      `SELECT v.id, v.name, v.x, v.y, v.points, v.owner_id, v.kind, p.username, p.protection_until > now() AS protected, t.id AS tribe_id, t.tag,
              (p.relic_until > now() OR t.relic_until > now()) AS relic,
              (SELECT coalesce(ht.tag, hp.username) FROM crusades cr LEFT JOIN tribes ht ON ht.id = cr.holder_tribe_id LEFT JOIN players hp ON hp.id = cr.holder_player_id
               WHERE cr.village_id = v.id AND cr.status <> 'ended' AND (cr.holder_tribe_id IS NOT NULL OR cr.holder_player_id IS NOT NULL)) AS holder
       FROM villages v LEFT JOIN players p ON p.id = v.owner_id LEFT JOIN tribes t ON t.id = p.tribe_id
       WHERE v.x BETWEEN $1 AND $3 AND v.y BETWEEN $2 AND $4
         AND (v.kind = 'village' OR EXISTS (SELECT 1 FROM crusades cr WHERE cr.village_id = v.id AND cr.status <> 'ended'))`,
      [q.x0, q.y0, q.x1, q.y1],
    );
    // Citadelle d'une croisade : état en direct pour la carte (bannière, muraille, armées en marche, fenêtre d'assaut).
    const citadelIds = rows.filter((r) => r.kind === 'citadel').map((r) => r.id as number);
    const live = new Map<number, NonNullable<MapVillage['crusade']>>();
    if (citadelIds.length) {
      const { rows: crs } = await pool.query(
        `SELECT cr.village_id, cr.opens_at, cr.closes_at, cr.holder_tribe_id, cr.holder_player_id, (v.buildings->>'wall')::int AS wall,
                (SELECT count(*)::int FROM commands cm WHERE cm.target_village_id = cr.village_id AND NOT cm.processed AND cm.type = 'attack'
                   AND coalesce((cm.units->>'scout')::int, 0) < (SELECT sum(value::int) FROM jsonb_each_text(cm.units))) AS attacks,
                (SELECT count(*)::int FROM commands cm WHERE cm.target_village_id = cr.village_id AND NOT cm.processed AND cm.type = 'support') AS supports
         FROM crusades cr JOIN villages v ON v.id = cr.village_id WHERE cr.village_id = ANY($1::int[]) AND cr.status <> 'ended'`,
        [citadelIds],
      );
      for (const c of crs) {
        live.set(c.village_id, {
          opensAt: new Date(c.opens_at).toISOString(),
          closesAt: new Date(c.closes_at).toISOString(),
          wall: c.wall ?? 0,
          holderTribeId: c.holder_tribe_id,
          holderPlayerId: c.holder_player_id,
          attacks: c.attacks,
          supports: c.supports,
        });
      }
    }
    return rows.map(
      (r): MapVillage => ({
        id: r.id,
        name: r.name,
        x: r.x,
        y: r.y,
        points: r.points,
        ownerId: r.owner_id,
        ownerName: r.username,
        tribeId: r.tribe_id,
        tribeTag: r.tag,
        protected: r.protected === true,
        ...(r.kind === 'citadel' ? { kind: 'citadel' as const, holderTag: r.holder ?? null, crusade: live.get(r.id) } : {}),
        ...(r.relic ? { relic: true } : {}),
      }),
    );
  });

  /**
   * Attaques et soutiens en route que le joueur connaît : ceux qu'il a envoyés (sur le village visé) et ceux qui visent
   * ses villages (sur son village), comme dans la liste des mouvements de son village.
   */
  app.get('/api/map/movements', async (req): Promise<MapMovement[]> => {
    const playerId = await requirePlayer(req);
    const { rows } = await pool.query(
      `SELECT c.target_village_id AS id,
              bool_or(c.type = 'attack') AS attack,
              bool_or(c.type = 'support') AS support,
              bool_or(c.type = 'attack' AND c.player_id <> $1) AS threat
       FROM commands c JOIN villages t ON t.id = c.target_village_id
       WHERE NOT c.processed AND c.type IN ('attack', 'support') AND (c.player_id = $1 OR t.owner_id = $1)
       GROUP BY c.target_village_id`,
      [playerId],
    );
    return rows.map((r) => ({ villageId: r.id, attack: r.attack, support: r.support, threat: r.threat }));
  });

  /**
   * Armées en marche que le joueur peut voir sur la carte : les siennes, celles de sa tribu et de ses alliés, celles qui visent
   * ses villages, et les autres seulement pendant qu'elles passent à portée de vue de l'un de ses villages (ni origine ni destination).
   * Une seule requête par rechargement de la carte : le client anime le trajet tout seul entre deux rechargements.
   */
  app.get('/api/map/armies', async (req): Promise<MapArmy[]> => {
    const playerId = await requirePlayer(req);
    const tribeId = ((await pool.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id ?? null) as number | null;
    const allies = await allyTribeIdsOf(pool, tribeId);
    const mine = (await pool.query('SELECT x, y FROM villages WHERE owner_id = $1', [playerId])).rows as { x: number; y: number }[];
    const { rows } = await pool.query(
      `SELECT c.id, c.type, c.player_id, c.units, c.sent_at, c.arrive_at, o.x AS ox, o.y AS oy, t.x AS tx, t.y AS ty, t.owner_id AS t_owner, pp.tribe_id, pp.username
       FROM commands c JOIN villages o ON o.id = c.origin_village_id JOIN villages t ON t.id = c.target_village_id LEFT JOIN players pp ON pp.id = c.player_id
       WHERE NOT c.processed AND c.arrive_at > now() AND (
         c.player_id = $1
         OR pp.tribe_id = ANY($2::int[])
         OR (t.owner_id = $1 AND c.type IN ('attack', 'support'))
         OR EXISTS (SELECT 1 FROM villages m WHERE m.owner_id = $1
                    AND m.x BETWEEN least(o.x, t.x) - $3 AND greatest(o.x, t.x) + $3 AND m.y BETWEEN least(o.y, t.y) - $3 AND greatest(o.y, t.y) + $3))
       ORDER BY c.arrive_at LIMIT 600`,
      [playerId, tribeId ? [tribeId, ...allies] : [], ARMY_SIGHT],
    );
    const now = Date.now();
    const out: MapArmy[] = [];
    for (const r of rows) {
      const units = normalizeUnits(r.units);
      const scouts = units.scout > 0 && units.scout === totalUnits(units);
      const sent = new Date(r.sent_at).getTime();
      const arrive = new Date(r.arrive_at).getTime();
      const from = { x: r.ox + 0.5, y: r.oy + 0.5 };
      const to = { x: r.tx + 0.5, y: r.ty + 0.5 };
      const known = (rel: MapArmy['rel'], seeUnits: boolean, owner: string | null): MapArmy => ({
        id: r.id,
        type: r.type,
        rel,
        from,
        to,
        fromAt: new Date(sent).toISOString(),
        toAt: new Date(arrive).toISOString(),
        size: seeUnits ? armySize(populationOf(units)) : 2,
        scouts: seeUnits && scouts,
        owner,
      });
      if (r.player_id === playerId) out.push(known('own', true, r.username));
      else if (tribeId && r.tribe_id === tribeId) out.push(known('tribe', true, r.username));
      else if (r.tribe_id && allies.includes(r.tribe_id)) out.push(known('ally', true, r.username));
      else if (r.t_owner === playerId && r.type === 'attack') out.push(known('threat', false, r.username));
      else if (r.t_owner === playerId && r.type === 'support') out.push(known('guest', false, r.username));
      else {
        // Armée aperçue : on voit sa taille, mais seule la portion du trajet à portée de vue est envoyée.
        const w = sightWindow({ x: r.ox, y: r.oy }, { x: r.tx, y: r.ty }, mine);
        if (!w) continue;
        const at = (u: number) => sent + (arrive - sent) * u;
        if (at(w[1]) <= now) continue;
        const pos = (u: number) => ({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u });
        out.push({ id: r.id, type: 'unknown', rel: 'seen', from: pos(w[0]), to: pos(w[1]), fromAt: new Date(at(w[0])).toISOString(), toAt: new Date(at(w[1])).toISOString(), size: armySize(populationOf(units)), scouts, owner: null });
      }
    }
    return out;
  });

  /** Tribus en guerre avec celle du joueur et tribus alliées, pour les couleurs de la carte. */
  app.get('/api/map/relations', async (req): Promise<MapRelations> => {
    const playerId = await requirePlayer(req);
    const { rows } = await pool.query(
      `SELECT DISTINCT CASE WHEN w.declarer_id = p.tribe_id THEN w.target_id ELSE w.declarer_id END AS id
       FROM players p JOIN tribe_wars w ON p.tribe_id IN (w.declarer_id, w.target_id)
       WHERE p.id = $1 AND w.ended_at IS NULL AND w.until > now()`,
      [playerId],
    );
    const tribeId = (await pool.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id ?? null;
    return { warTribeIds: rows.map((r) => r.id as number), allyTribeIds: await allyTribeIdsOf(pool, tribeId) };
  });

  /** Villages barbares autour d'un village du joueur, avec le résultat de sa dernière attaque ou de son dernier espionnage. */
  app.get('/api/villages/:id/raid-targets', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { radius } = z.object({ radius: z.coerce.number().int().min(1).max(60).default(15) }).parse(req.query);
    const home = (await pool.query('SELECT x, y FROM villages WHERE id = $1 AND owner_id = $2', [id, playerId])).rows[0];
    if (!home) throw forbidden("Ce village n'est pas à vous");
    const { rows } = await pool.query(
      `SELECT id, name, x, y, points, sqrt((x - $1)^2 + (y - $2)^2) AS dist FROM villages
       WHERE owner_id IS NULL AND kind = 'village' AND (x - $1)^2 + (y - $2)^2 <= $3 ORDER BY dist, id LIMIT 200`,
      [home.x, home.y, radius * radius],
    );
    const ids = rows.map((r) => r.id as number);
    const last = new Map<number, { type: string; data: any; at: Date }>();
    const history = new Map<number, { type: string; data: unknown; created_at: Date }[]>();
    const moving = new Set<number>();
    if (ids.length) {
      const reports = await pool.query(
        `SELECT (data->'defender'->'village'->>'id')::int AS target, type, data, created_at
         FROM reports WHERE player_id = $1 AND type IN ('scout', 'attack') AND (data->'defender'->'village'->>'id')::int = ANY($2::int[])
         ORDER BY created_at DESC, id DESC LIMIT 3000`,
        [playerId, ids],
      );
      for (const r of reports.rows) {
        if (!last.has(r.target)) last.set(r.target, { type: r.type, data: r.data, at: r.created_at });
        const h = history.get(r.target) ?? [];
        if (h.length < 20) h.push(r);
        history.set(r.target, h);
      }
      const cmds = await pool.query("SELECT DISTINCT target_village_id FROM commands WHERE player_id = $1 AND NOT processed AND type = 'attack' AND target_village_id = ANY($2::int[])", [playerId, ids]);
      for (const r of cmds.rows) moving.add(r.target_village_id);
    }
    const now = new Date();
    return rows.map((r): RaidTarget => {
      const l = last.get(r.id);
      const h = history.get(r.id) ?? [];
      const intel = pickIntel(h);
      let status: RaidStatus = 'never';
      let loot = 0;
      if (l?.type === 'scout') status = 'scouted';
      else if (l) {
        const d = l.data;
        const lost = UNIT_KEYS.reduce((n, k) => n + (d.attacker?.losses?.[k] ?? 0), 0);
        status = !d.attackerWins ? 'lost' : lost > 0 ? 'losses' : 'clean';
        if (d.attackerWins && d.loot) loot = RESOURCES.reduce((n, k) => n + (d.loot[k] ?? 0), 0);
      }
      return { id: r.id, name: r.name, x: r.x, y: r.y, points: r.points, distance: Math.round(r.dist * 10) / 10, status, lastAt: l ? new Date(l.at).toISOString() : null, lastLoot: loot, intel, lootable: estimateLoot(h, now, env.worldSpeed, intel?.troops ?? null), underAttack: moving.has(r.id) };
    });
  });
}
