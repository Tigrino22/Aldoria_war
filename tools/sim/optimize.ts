// Recherche locale sur l'ordre de construction d'un modèle du gestionnaire : npx tsx tools/sim/optimize.ts Offensif [essais]
// Score : moyenne, du jour 5 au jour 70, de (points / 17 000 + population / population visée), simulation x1 sans pillage.
// Garde minimale : un village sans troupes après la protection débutant serait pillé, donc le score chute sous GUARD.
import { readFileSync } from 'node:fs';
import { BUILDINGS, UNITS, type BuildingKey } from '../../shared/src/index';
import { MAX_PLAN_LINES, PRESETS, type Plan } from '../../server/src/manager/rules';
import { simulate } from './manager-sim';

const name = process.argv[2] ?? 'Offensif';
const tries = Number(process.argv[3] ?? 600);
const base = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) as Plan : PRESETS.find((p) => p.name === name)!.plan;
const days = Array.from({ length: 14 }, (_, i) => 5 * (i + 1));
/** Population minimale attendue à ces jours (fin de la protection débutant au jour 5). */
const GUARD: Record<number, number> = { 10: 150, 15: 400, 20: 800 };
const goalPop = Object.entries(base.troops).reduce((n, [u, c]) => n + UNITS[u as keyof typeof UNITS].population * (c ?? 0), 0);

function score(plan: Plan, tick = 120): number {
  const snaps = simulate(plan, days, tick);
  const penalty = snaps.reduce((s, x) => s + (GUARD[x.day] && x.pop < GUARD[x.day] ? (GUARD[x.day] - x.pop) / GUARD[x.day] : 0), 0);
  return snaps.reduce((s, x) => s + x.points / 17000 + x.pop / goalPop, 0) / snaps.length - penalty;
}

let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

function mutate(p: Plan): Plan {
  const b = p.buildings.map((x) => ({ ...x }));
  const kind = Math.floor(rand() * 5);
  const i = Math.floor(rand() * b.length);
  if (kind === 0 && i + 1 < b.length) [b[i], b[i + 1]] = [b[i + 1], b[i]];
  else if (kind === 1) { const [x] = b.splice(i, 1); b.splice(Math.floor(rand() * (b.length + 1)), 0, x); }
  else if (kind === 2) { const d = pick([-2, -1, 1, 2]); b[i].level = Math.max(1, Math.min(BUILDINGS[b[i].building].maxLevel, b[i].level + d)); }
  else if (kind === 3 && b.length < MAX_PLAN_LINES) { const key = pick(Object.keys(BUILDINGS) as BuildingKey[]); b.splice(i, 0, { building: key, level: 1 + Math.floor(rand() * BUILDINGS[key].maxLevel) }); }
  else if (kind === 4 && b.length > 5) b.splice(i, 1);
  // Les lignes déjà atteintes par une ligne plus haute ne servent à rien : on les retire.
  const top = new Map<BuildingKey, number>();
  for (let k = 0; k < b.length; k++) {
    if ((top.get(b[k].building) ?? 0) >= b[k].level) { b.splice(k, 1); k--; continue; }
    top.set(b[k].building, b[k].level);
  }
  const share = rand() < 0.15 ? Math.max(0, Math.min(100, p.troopsShare + pick([-5, 5]))) : p.troopsShare;
  return { ...p, buildings: b, troopsShare: share };
}

// Le plan doit garder les niveaux finaux du modèle de départ.
const finals = new Map<BuildingKey, number>();
for (const t of base.buildings) finals.set(t.building, Math.max(finals.get(t.building) ?? 0, t.level));
const valid = (p: Plan) => [...finals].every(([k, l]) => p.buildings.some((t) => t.building === k && t.level >= l));

let best = base;
let bestScore = score(best);
console.log('départ', bestScore.toFixed(4));
for (let n = 0; n < tries; n++) {
  const cand = mutate(best);
  if (!valid(cand)) continue;
  const s = score(cand);
  if (s > bestScore) { best = cand; bestScore = s; console.log(n, s.toFixed(4), best.troopsShare, best.buildings.length); }
}
console.log('final (60 s)', score(best, 60).toFixed(4), 'départ (60 s)', score(base, 60).toFixed(4));
console.log(JSON.stringify(best));
