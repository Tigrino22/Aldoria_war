import { useCallback, useEffect, useState } from 'react';
import { ITEM_LABEL, RESOURCES, treasureGain, type InventoryItem, type Resources } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame, useNow } from '../game';
import { ResIcon, liveResources } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import { NavIcon } from './NavIcon';
import './inventory.css';

/** Inventaire : trésors des bastions, à vider dans l'entrepôt du village actif. */
export default function Inventory() {
  const { village, run, toast, refreshVillage, refreshMe } = useGame();
  const now = useNow();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const load = useCallback(() => run(async () => setItems(await api<InventoryItem[]>('/api/items'))), [run]);
  useEffect(() => {
    load();
  }, [load]);

  const res = village ? liveResources(village, now) : null;
  const use = (item: InventoryItem) =>
    run(async () => {
      if (!village) return;
      const { gain } = await api<{ gain: Resources }>(`/api/items/${item.id}/use`, { body: { villageId: village.id } });
      toast(`Trésor vidé à ${village.name} : ${RESOURCES.map((r) => fmt(gain[r])).join(' / ')}`);
      await Promise.all([refreshVillage(), refreshMe(), load()]);
    });

  return (
    <div className="pg inventory">
      <PageBanner
        icon="tresor"
        kicker="Village · réserves"
        title="Inventaire"
        lead="Les trésors gagnés en prenant le contrôle d'une province et les coffres de vos succès. Chacun remplit une part de l'entrepôt du village de votre choix : passez sur le bon village en haut de l'écran, puis utilisez-le."
        stats={[
          { value: items?.length ?? '–', label: 'Objets', tone: 'gold' },
          { value: village ? fmt(village.capacity) : '–', label: `Entrepôt de ${village?.name ?? 'votre village'}` },
        ]}
      />
      <section className="pg-card">
        <CardTitle icon="tresor" count={items?.length}>
          Vos objets
        </CardTitle>
        {!items ? (
          <p className="muted">Chargement…</p>
        ) : !items.length ? (
          <p className="muted">
            Votre inventaire est vide. Prenez un bastion avec votre tribu et tenez-le jusqu'au contrôle de la province : chaque membre reçoit un trésor, plus gros pour les provinces proches de la{' '}
            <a href="#/provinces">Terre sainte</a>. Chaque palier de vos <a href="#/succes">succès</a> donne aussi un coffre.
          </p>
        ) : (
          <ul className="inv-list">
            {items.map((item) => {
              const gain = village && res ? treasureGain(res, village.capacity, item.percent) : null;
              const full = gain ? RESOURCES.every((r) => gain[r] <= 0) : true;
              return (
                <li key={item.id} className="inv-item">
                  <span className="inv-medal">
                    <NavIcon name={item.kind === 'chest' ? 'medaille' : 'tresor'} size={28} />
                    <b>{item.percent} %</b>
                  </span>
                  <div className="inv-main">
                    <b>{ITEM_LABEL[item.kind]}</b>
                    <span className="muted small">
                      Remplit {item.percent} % de l'entrepôt pour chaque ressource{item.source ? ` · ${item.source}` : ''}
                    </span>
                    {gain && (
                      <span className="inv-gain">
                        {RESOURCES.map((r) => (
                          <span key={r}>
                            <ResIcon r={r} size={18} /> +{fmt(gain[r])}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <button className="btn gold" disabled={!village || full} onClick={() => use(item)} title={full ? "L'entrepôt de ce village est déjà plein" : undefined}>
                    {full ? 'Entrepôt plein' : `Utiliser sur ${village?.name ?? ''}`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
