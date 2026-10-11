import { RESOURCES, warehouseCapacity } from '@aldoria/shared';
import { tx } from '../db';
import { saveVillage, syncVillage } from './village';

/**
 * Outil d'administration : remplit les entrepôts de tous les villages de PNJ jusqu'à `percent` % de leur capacité.
 * Une ressource déjà au-dessus de ce seuil n'est jamais réduite. Renvoie le nombre de villages touchés.
 */
export async function fillNpcWarehouses(percent: number, now: Date): Promise<{ villages: number; changed: number }> {
  const share = Math.max(0, Math.min(100, percent)) / 100;
  return tx(async (c) => {
    const ids = (await c.query('SELECT v.id FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.is_npc ORDER BY v.id')).rows.map((r) => r.id as number);
    let changed = 0;
    for (const id of ids) {
      const v = await syncVillage(c, id, now);
      const target = Math.floor(warehouseCapacity(v.buildings.warehouse) * share);
      let touched = false;
      for (const r of RESOURCES) {
        if (v[r] < target) {
          v[r] = target;
          touched = true;
        }
      }
      if (touched) {
        await saveVillage(c, v);
        changed++;
      }
    }
    return { villages: ids.length, changed };
  });
}
