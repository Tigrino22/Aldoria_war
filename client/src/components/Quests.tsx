import { useCallback, useEffect, useState } from 'react';
import { type QuestView } from '@aldoria/shared';
import { api } from '../api';
import { useGame } from '../game';
import { Cost, Panel } from '../ui';

/** Quêtes de départ : un guide pour les nouveaux joueurs, avec une petite récompense à récupérer. */
export default function Quests() {
  const { village: v, setVillage, run, toast } = useGame();
  const [quests, setQuests] = useState<QuestView[] | null>(null);
  const load = useCallback(() => run(async () => setQuests(await api<QuestView[]>('/api/quests'))), [run]);
  // La liste dépend de ce que le village contient : on la relit quand les files ou les troupes changent.
  const signature = v ? `${v.id}:${JSON.stringify(v.buildings)}:${JSON.stringify(v.troopsHome)}:${v.recruitQueue.length}` : '';
  useEffect(() => {
    load();
  }, [load, signature]);

  if (!quests || !v) return null;
  const open = quests.filter((q) => !q.claimed);
  if (open.length === 0) return null;
  const ready = open.filter((q) => q.done);
  const next = open.filter((q) => !q.done).slice(0, 3);

  const claim = (q: QuestView) =>
    run(async () => {
      setVillage(await api(`/api/quests/${q.key}/claim`, { body: { villageId: v.id } }));
      toast(`Récompense récupérée : ${q.title}`);
      await load();
    });

  return (
    <Panel title={`Premiers pas (${quests.length - open.length}/${quests.length})`}>
      <ul className="list quests">
        {[...ready, ...next].map((q) => (
          <li key={q.key} className="row between">
            <span>
              <b>{q.title}</b>
              <br />
              <span className="muted small">{q.description}</span>
            </span>
            {q.done ? (
              <button className="btn small primary" onClick={() => claim(q)}>
                Récupérer <Cost cost={q.reward} />
              </button>
            ) : (
              <span className="muted small">
                à faire · <Cost cost={q.reward} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {open.length > ready.length + next.length && (
        <p className="muted small">Encore {open.length - ready.length - next.length} quête(s) à venir.</p>
      )}
    </Panel>
  );
}
