// Compare les modèles du gestionnaire : npx tsx tools/sim/run.ts
import { PRESETS } from '../../server/src/manager/rules';
import { simulate } from './manager-sim';
const days = [7, 14, 21, 30, 45, 60, 90];
for (const p of PRESETS) {
  console.log('==', p.name);
  for (const s of simulate(p.plan, days)) console.log(`jour ${s.day} : ${s.points} pts, population ${s.pop}, attaque ${s.attack}, déf. inf. ${s.defInf}, déf. cav. ${s.defCav} | ${s.levels}`);
}
