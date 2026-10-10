import { useState, type ReactNode } from 'react';
import {
  BASE_VILLAGE_DEFENSE,
  BEGINNER_PROTECTION_HOURS,
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  HIDDEN_SHARE,
  LOYALTY_AFTER_CONQUEST,
  LOYALTY_REGEN_PER_HOUR,
  MERCHANT_CAPACITY,
  MERCHANT_SPEED,
  NOBLE_LOYALTY_MAX,
  NOBLE_LOYALTY_MIN,
  RAMS_PER_WALL_LEVEL_DESTROYED,
  RAMS_PER_WALL_LEVEL_IN_COMBAT,
  RESOURCES,
  RESOURCE_NAMES,
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  UNITS,
  UNIT_KEYS,
  WALL_BONUS_PER_LEVEL,
  buildingCost,
  buildingTime,
  hiddenResources,
  merchantCount,
  recruitTime,
  resourceProduction,
  villagePoints,
  wallBonus,
  warehouseCapacity,
  type BuildingKey,
  type Buildings,
  type Resources,
  type UnitKey,
} from '@aldoria/shared';
import { buildingImg } from '../assets';
import { duration, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { Cost, Panel, ResIcon, UnitIcon } from '../ui';

// Toutes les valeurs affichées ici sont calculées à partir de @aldoria/shared, exactement comme sur le serveur :
// modifier l'équilibrage dans shared/src/config.ts met le wiki à jour automatiquement.

const SECTIONS = [
  { id: 'debuter', title: 'Bien débuter' },
  { id: 'ressources', title: 'Ressources et production' },
  { id: 'construction', title: 'Construction' },
  { id: 'armee', title: 'Recrutement et entretien' },
  { id: 'combat', title: 'Attaque, combat et pillage' },
  { id: 'espionnage', title: 'Espionnage' },
  { id: 'muraille', title: 'Muraille et béliers' },
  { id: 'conquete', title: 'Nobles et conquête' },
  { id: 'renforts', title: 'Renforts' },
  { id: 'marche', title: 'Marché et marchands' },
  { id: 'carte', title: 'Carte et villages barbares' },
  { id: 'social', title: 'Rapports, messages, tribus, classement' },
  { id: 'compte', title: 'Compte et villages' },
  { id: 'batiments', title: 'Fiches des bâtiments' },
  { id: 'troupes', title: 'Fiches des troupes' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const LEVELS = (max: number) => Array.from({ length: max }, (_, i) => i + 1);
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`.replace('.', ',');
const total = (r: Resources) => RESOURCES.reduce((s, k) => s + r[k], 0);
const requiresText = (req: Partial<Buildings>) => {
  const parts = Object.entries(req).map(([k, lvl]) => `${BUILDINGS[k as BuildingKey].name} niveau ${lvl}`);
  return parts.length ? parts.join(', ') : 'Aucune';
};
/** Points rapportés par un bâtiment seul à ce niveau, avec la formule de score du serveur. */
const pointsAt = (key: BuildingKey, level: number) => villagePoints({ ...zeroBuildings(), [key]: level });
const zeroBuildings = (): Buildings => Object.fromEntries(BUILDING_KEYS.map((k) => [k, 0])) as Buildings;

const RESOURCE_BUILDING: Partial<Record<BuildingKey, keyof Resources>> = { woodcutter: 'wood', claypit: 'clay', ironmine: 'iron', farm: 'wheat' };

/** Intitulé de la colonne « bonus » d'une fiche bâtiment. */
function bonusLabel(key: BuildingKey): string {
  if (RESOURCE_BUILDING[key]) return `Production de ${RESOURCE_NAMES[RESOURCE_BUILDING[key]!].toLowerCase()} / h`;
  switch (key) {
    case 'townhall': return 'Durée des constructions';
    case 'warehouse': return 'Capacité / cachette';
    case 'market': return 'Marchands (capacité)';
    case 'barracks': return 'Durée de recrutement';
    case 'wall': return 'Bonus de défense';
    default: return 'Bonus';
  }
}

function bonusAt(key: BuildingKey, level: number, speed: number): string {
  if (RESOURCE_BUILDING[key]) return fmt(resourceProduction(level) * speed);
  switch (key) {
    case 'townhall': return `x${(Math.pow(0.95, level - 1)).toFixed(2).replace('.', ',')} (−${pct(1 - Math.pow(0.95, level - 1))})`;
    case 'warehouse': return `${fmt(warehouseCapacity(level))} / ${fmt(hiddenResources(level))}`;
    case 'market': return `${merchantCount(level)} (${fmt(merchantCount(level) * MERCHANT_CAPACITY)})`;
    case 'barracks': return `x${(Math.pow(0.94, level - 1)).toFixed(2).replace('.', ',')} (−${pct(1 - Math.pow(0.94, level - 1))})`;
    case 'wall': return `+${pct(wallBonus(level) - 1)}`;
    default: return '–';
  }
}

function bonusSummary(key: BuildingKey, speed: number): string {
  if (RESOURCE_BUILDING[key]) {
    const extra = key === 'farm' ? " Le blé nourrit aussi l'armée : l'entretien des troupes est retiré de cette production." : '';
    return `Produit ${fmt(resourceProduction(1) * speed)} ${RESOURCE_NAMES[RESOURCE_BUILDING[key]!].toLowerCase()} par heure au niveau 1, ${fmt(resourceProduction(20) * speed)} au niveau 20 (sans bâtiment : ${fmt(resourceProduction(0) * speed)} par heure).${extra}`;
  }
  switch (key) {
    case 'townhall': return 'Chaque niveau au-delà du premier réduit de 5 % la durée de toutes les constructions du village. Il débloque le marché, la caserne et, au niveau 10, le noble.';
    case 'warehouse': return `Fixe la quantité maximale de chaque ressource. Au-delà, la production est perdue. ${pct(HIDDEN_SHARE)} de la capacité est cachée : les pillards ne peuvent pas la prendre.`;
    case 'market': return `Donne des marchands qui portent chacun ${fmt(MERCHANT_CAPACITY)} ressources vers d'autres villages de joueurs.`;
    case 'barracks': return "Permet de recruter les troupes. Chaque niveau au-delà du premier réduit de 6 % la durée de recrutement et débloque de nouvelles unités.";
    case 'wall': return `Chaque niveau ajoute ${pct(WALL_BONUS_PER_LEVEL)} à la défense de toutes les troupes présentes dans le village, renforts compris.`;
    default: return '';
  }
}

function unitNote(key: UnitKey): string | null {
  switch (key) {
    case 'scout': return "Envoyé seul, il espionne au lieu de combattre. Accompagnant une attaque victorieuse, les éclaireurs survivants rapportent ce qu'il reste dans le village.";
    case 'ram': return `Pendant le combat, la muraille perd 1 niveau tous les ${RAMS_PER_WALL_LEVEL_IN_COMBAT} béliers. Après une victoire, chaque groupe de ${RAMS_PER_WALL_LEVEL_DESTROYED} béliers survivants détruit 1 niveau de muraille.`;
    case 'noble': return `Chaque noble survivant d'une attaque victorieuse fait baisser la loyauté de ${NOBLE_LOYALTY_MIN} à ${NOBLE_LOYALTY_MAX} points. À 0, le village est conquis.`;
    default: return null;
  }
}

export default function Wiki({ section, item }: { section?: string; item?: string }) {
  const [, go] = useRoute();
  const current = SECTIONS.find((s) => s.id === section)?.id;

  return (
    <div className="wiki">
      <nav className="wiki-toc" aria-label="Sommaire du wiki">
        <a href="#/wiki" className={!current ? 'active' : ''}>Sommaire</a>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/wiki/${s.id}`} className={current === s.id ? 'active' : ''}>
            {s.title}
          </a>
        ))}
      </nav>
      <div className="wiki-body">
        {!current && <Home />}
        {current === 'batiments' && (item && item in BUILDINGS ? <BuildingSheet k={item as BuildingKey} /> : <BuildingIndex />)}
        {current === 'troupes' && (item && item in UNITS ? <UnitSheet k={item as UnitKey} /> : <UnitIndex />)}
        {current && current !== 'batiments' && current !== 'troupes' && <Guide id={current} />}
        {current && (
          <p>
            <button className="btn small ghost" onClick={() => go(item ? `wiki/${current}` : 'wiki')}>
              ← Retour {item ? `aux ${current === 'batiments' ? 'bâtiments' : 'troupes'}` : 'au sommaire'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function Home() {
  const { world } = useGame();
  return (
    <Panel title="Wiki d'Aldoria War">
      <p>
        Tout ce qu'il faut savoir pour faire grandir votre village. Les chiffres de ce wiki sont calculés directement à partir des règles du jeu, ils sont donc
        toujours à jour. Ce monde tourne en <b>vitesse x{world.speed}</b> : les productions sont multipliées par {world.speed} et les durées divisées par {world.speed}.
      </p>
      <div className="wiki-grid">
        {SECTIONS.map((s) => (
          <a key={s.id} className="wiki-card" href={`#/wiki/${s.id}`}>
            {s.title}
          </a>
        ))}
      </div>
    </Panel>
  );
}

// ---------- Fonctionnalités ----------

function Guide({ id }: { id: Exclude<SectionId, 'batiments' | 'troupes'> }) {
  const { world } = useGame();
  const s = world.speed;
  const title = SECTIONS.find((x) => x.id === id)!.title;
  const B = (k: BuildingKey) => <a href={`#/wiki/batiments/${k}`}>{BUILDINGS[k].name}</a>;
  const U = (k: UnitKey) => <a href={`#/wiki/troupes/${k}`}>{UNITS[k].name}</a>;
  const content: Record<typeof id, ReactNode> = {
    debuter: (
      <>
        <p>
          À l'inscription, vous recevez un village placé autour du centre de la carte, avec <Cost cost={STARTING_RESOURCES} /> et ces bâtiments au niveau 1 :{' '}
          {BUILDING_KEYS.filter((k) => STARTING_BUILDINGS[k] > 0).map((k, i) => (
            <span key={k}>{i > 0 && ', '}{B(k)}</span>
          ))}
          .
        </p>
        <p>
          <b>Protection débutant :</b> pendant {duration((BEGINNER_PROTECTION_HOURS / s) * 3600)} (soit {BEGINNER_PROTECTION_HOURS} h à vitesse x1), aucun joueur ne
          peut vous attaquer. Attention : si vous attaquez vous-même un autre joueur, votre protection s'arrête aussitôt. Les villages barbares peuvent être attaqués sans perdre la protection.
        </p>
        <p>Conseil de départ : montez les quatre bâtiments de ressources, puis l'{B('townhall')} au niveau 3 pour débloquer la {B('barracks')} et le {B('market')}.</p>
        <p>
          <b>Premiers pas :</b> une liste de quêtes vous guide au début ; chaque quête accomplie rapporte une récompense à récupérer.
        </p>
        <p>
          <b>Annulations :</b> vous pouvez annuler une construction, un recrutement ou un mouvement de troupes en cours (une partie des ressources est rendue pour les deux premiers).
        </p>
      </>
    ),
    ressources: (
      <>
        <p>
          Il y a quatre ressources : {RESOURCES.map((r, i) => <span key={r}>{i > 0 && ', '}<ResIcon r={r} size={16} /> {RESOURCE_NAMES[r]}</span>)}. Le {B('woodcutter')},
          l'{B('claypit')}, la {B('ironmine')} et la {B('farm')} les produisent en continu, même quand vous n'êtes pas connecté.
        </p>
        <p>
          Un bâtiment de ressource produit {fmt(resourceProduction(1) * s)} par heure au niveau 1 et +20 % par niveau, jusqu'à {fmt(resourceProduction(20) * s)} par heure au niveau 20.
        </p>
        <p>
          <b>Le blé</b> nourrit vos troupes : la production affichée est nette de l'entretien de toute votre armée (troupes au village, en renfort, en route et en recrutement). Si elle devient négative, le stock baisse jusqu'à 0.
        </p>
        <p>
          <b>Stockage :</b> l'{B('warehouse')} fixe le maximum de chaque ressource ({fmt(warehouseCapacity(1))} au niveau 1, {fmt(warehouseCapacity(20))} au niveau 20). Une ressource pleine ne produit plus, tout ce qui
          dépasse (production, butin, livraison) est perdu. {pct(HIDDEN_SHARE)} de cette capacité est cachée et ne peut pas être pillée.
        </p>
      </>
    ),
    construction: (
      <>
        <p>Touchez un emplacement de la vue du village pour construire ou améliorer un bâtiment. Le coût est payé tout de suite.</p>
        <ul>
          <li>La file de construction accepte {BUILD_QUEUE_LIMIT} chantiers à la fois ; le second commence quand le premier est terminé.</li>
          <li>Chaque bâtiment monte jusqu'au niveau 20. Le coût est multiplié par 1,25 ou 1,26 et la durée par 1,2 à chaque niveau.</li>
          <li>Chaque niveau d'{B('townhall')} au-delà du premier réduit de 5 % la durée de toutes les constructions.</li>
          <li>Certains bâtiments ont des prérequis : {B('market')} ({requiresText(BUILDINGS.market.requires)}), {B('barracks')} ({requiresText(BUILDINGS.barracks.requires)}), {B('wall')} ({requiresText(BUILDINGS.wall.requires)}).</li>
          <li>Chaque niveau rapporte des points de classement : le niveau N rapporte N points, donc un bâtiment au niveau N vaut N×(N+1)/2 points (210 au niveau 20).</li>
          <li>L'aspect du bâtiment change aux niveaux 7 et 14.</li>
        </ul>
        <p>Toutes les valeurs par niveau sont dans les <a href="#/wiki/batiments">fiches des bâtiments</a>.</p>
      </>
    ),
    armee: (
      <>
        <p>La {B('barracks')} recrute les troupes. Choisissez l'unité et le nombre : tout est payé d'avance, puis les soldats arrivent un par un.</p>
        <ul>
          <li>Chaque unité demande un niveau de caserne (et parfois d'autres bâtiments) : voir les <a href="#/wiki/troupes">fiches des troupes</a>.</li>
          <li>Chaque niveau de caserne au-delà du premier réduit de 6 % la durée de recrutement.</li>
          <li>
            <b>Entretien :</b> chaque unité consomme du blé par heure. On ne peut recruter que si la production de la {B('farm')} couvre l'entretien de toute l'armée, recrues comprises
            (les valeurs de la caserne sont données à vitesse x1).
          </li>
        </ul>
      </>
    ),
    combat: (
      <>
        <p>Depuis la carte, choisissez un village puis « Attaquer » et les troupes à envoyer. Le trajet dure le temps de l'unité la plus lente multiplié par la distance (en cases).</p>
        <h3>Résolution du combat</h3>
        <ul>
          <li><b>Attaque</b> = somme des attaques de vos unités. On calcule la part d'infanterie et de cavalerie dans cette attaque.</li>
          <li>
            <b>Défense</b> = {BASE_VILLAGE_DEFENSE} (défense de base du village, même vide) + défense de chaque unité présente, pondérée : défense contre l'infanterie × part d'infanterie +
            défense contre la cavalerie × part de cavalerie. Le total est multiplié par le bonus de {B('wall')} (+{pct(WALL_BONUS_PER_LEVEL)} par niveau).
          </li>
          <li>Le camp le plus fort gagne (égalité : la défense gagne). Le perdant perd toutes ses troupes engagées.</li>
          <li>Le gagnant perd une part de ses troupes égale à (force du perdant ÷ sa force)<sup>1,5</sup>. Exemple : une attaque deux fois plus forte que la défense perd environ 35 % de ses troupes.</li>
          <li>Les renforts alliés présents dans le village se battent avec la garnison et subissent les mêmes pertes.</li>
        </ul>
        <h3>Pillage</h3>
        <p>
          Après une victoire, les survivants emportent des ressources selon leur capacité de butin, réparties le plus équitablement possible entre les quatre ressources. La partie cachée par
          l'{B('warehouse')} du défenseur est protégée. Le butin revient avec les troupes (dans la limite de votre entrepôt).
        </p>
        <p>Chaque attaque produit un rapport pour l'attaquant et le défenseur. Si tous vos soldats meurent, vous ne voyez pas les troupes adverses. Le défenseur est alerté dès le départ d'une attaque.</p>
      </>
    ),
    espionnage: (
      <>
        <p>Envoyez uniquement des {U('scout')}s en attaque pour espionner un village : pas de combat, pas de pillage.</p>
        <ul>
          <li>Si le village cible a autant ou plus d'éclaireurs que vous, tous les vôtres meurent.</li>
          <li>Sinon, vous en perdez : nombre envoyé × (éclaireurs adverses ÷ éclaireurs envoyés)<sup>1,5</sup>.</li>
          <li>Les survivants rapportent les ressources, les bâtiments et toutes les troupes présentes.</li>
          <li>Le défenseur n'est prévenu que s'il a tué au moins un de vos éclaireurs.</li>
        </ul>
      </>
    ),
    muraille: (
      <>
        <p>La {B('wall')} ajoute +{pct(WALL_BONUS_PER_LEVEL)} de défense par niveau (+{pct(wallBonus(20) - 1)} au niveau 20) à toutes les troupes du village.</p>
        <p>Les {U('ram')}s servent à la contourner :</p>
        <ul>
          <li>Pendant le combat, la muraille compte 1 niveau de moins tous les {RAMS_PER_WALL_LEVEL_IN_COMBAT} béliers envoyés.</li>
          <li>Après une victoire, chaque groupe de {RAMS_PER_WALL_LEVEL_DESTROYED} béliers survivants détruit réellement 1 niveau de muraille (le défenseur perd aussi les points correspondants).</li>
        </ul>
      </>
    ),
    conquete: (
      <>
        <p>Chaque village a une loyauté de 100. Pour prendre un village (joueur ou barbare), il faut l'attaquer avec des {U('noble')}s.</p>
        <ul>
          <li>Si l'attaque est victorieuse, chaque noble survivant fait baisser la loyauté de {NOBLE_LOYALTY_MIN} à {NOBLE_LOYALTY_MAX} points (tirage au hasard).</li>
          <li>La loyauté remonte de {fmt(LOYALTY_REGEN_PER_HOUR * s)} point{LOYALTY_REGEN_PER_HOUR * s > 1 ? 's' : ''} par heure, jusqu'à 100.</li>
          <li>À 0, le village est à vous : sa loyauté repart à {LOYALTY_AFTER_CONQUEST}, un noble s'y installe pour gouverner (il disparaît de l'armée) et les autres survivants deviennent la garnison.</li>
          <li>L'ancien propriétaire perd les constructions et recrutements en cours ainsi que toutes les troupes de ce village, y compris celles qui étaient en dehors.</li>
          <li>Un village conquis n'est pas pillé.</li>
        </ul>
      </>
    ),
    renforts: (
      <>
        <p>« Envoyer un renfort » envoie des troupes défendre un autre village : un des vôtres ou celui d'un allié.</p>
        <ul>
          <li>Les renforts combattent avec la garnison et profitent de la muraille du village qui les accueille.</li>
          <li>Leur entretien en blé reste à la charge de leur village d'origine.</li>
          <li>Depuis la page Troupes, vous pouvez rappeler vos renforts, ou renvoyer chez eux ceux qu'on vous a envoyés.</li>
          <li>Pour vos propres villages, utilisez toujours le renfort : on ne peut pas attaquer ses propres villages.</li>
        </ul>
      </>
    ),
    marche: (
      <>
        <p>
          Le {B('market')} ({requiresText(BUILDINGS.market.requires)}) donne des marchands qui transportent vos ressources vers vos autres villages ou ceux d'autres joueurs (jamais vers les barbares).
        </p>
        <ul>
          <li>Chaque marchand porte {fmt(MERCHANT_CAPACITY)} ressources, toutes ressources confondues.</li>
          <li>Ils avancent à {duration((MERCHANT_SPEED * 60) / s)} par case, puis rentrent à vide ; pendant ce temps ils ne sont pas disponibles.</li>
          <li>Nombre de marchands : {merchantCount(1)} au niveau 1, {merchantCount(10)} au niveau 10, {merchantCount(20)} au niveau 20.</li>
          <li>À l'arrivée, ce qui dépasse la capacité de l'entrepôt du destinataire est perdu.</li>
        </ul>
      </>
    ),
    carte: (
      <>
        <p>
          Le monde fait {world.mapSize} × {world.mapSize} cases. La distance entre deux villages se mesure en ligne droite, en cases. Les nouveaux joueurs apparaissent sur un anneau autour du centre
          qui s'élargit au fil des inscriptions.
        </p>
        <p>
          <b>Villages barbares :</b> des villages sans propriétaire sont répartis sur la carte. Plus ils sont loin du centre, plus ils sont développés et défendus (lanciers et épéistes). Ils ne
          recrutent pas et ne vous attaquent jamais : ce sont des cibles idéales pour piller, ou pour une première conquête.
        </p>
        <p>
          Les villages barbares pillés se reconstruisent : leur garnison se reforme peu à peu et ils gagnent des niveaux avec le temps. Les plus lointains sont aussi les mieux défendus.
        </p>
        <p>Touchez un village sur la carte pour voir son propriétaire, ses points et lui envoyer des troupes ou des marchands. Le pseudo d'un joueur ouvre son profil et la liste de ses villages.</p>
      </>
    ),
    social: (
      <>
        <h3>Rapports</h3>
        <p>Attaques, défenses, espionnages, renforts et livraisons créent un rapport. Un badge indique les rapports non lus ; vous pouvez les supprimer.</p>
        <h3>Messages</h3>
        <p>Écrivez à n'importe quel joueur en donnant son pseudo. Vous êtes prévenu en direct à la réception.</p>
        <h3>Tribus</h3>
        <ul>
          <li>Fondez une tribu avec un nom (3 à 32 caractères) et un tag (2 à 6 lettres ou chiffres), ou rejoignez-en une sur invitation.</li>
          <li>Le chef invite, exclut et rédige la description de la tribu.</li>
          <li>On ne peut appartenir qu'à une tribu à la fois.</li>
          <li>La page de tribu propose aux membres trois outils : les menaces (attaques extérieures en approche sur les villages de la tribu), un planificateur d'attaque groupée (heure de départ de chaque village pour arriver ensemble) et un message envoyé à toute la tribu.</li>
          <li>Les tribus peuvent s'allier ou se faire la guerre ; les renforts d'un allié sont les bienvenus.</li>
        </ul>
        <h3>Vue d'ensemble et aides à l'attaque</h3>
        <p>
          La vue d'ensemble liste tous vos villages (ressources, constructions, troupes, mouvements). Avant un envoi, la simulation estime le résultat d'un combat à partir de ce que vos éclaireurs ont appris, et vous
          pouvez enregistrer des modèles d'armée pour les réutiliser.
        </p>
        <h3>Classement</h3>
        <p>
          Les points d'un joueur sont la somme des points de ses villages, et ceux d'un village la somme des points de ses bâtiments (un bâtiment au niveau N vaut N×(N+1)/2 points). Le
          classement des tribus additionne les points de leurs membres.
        </p>
      </>
    ),
    compte: (
      <>
        <ul>
          <li>Vous pouvez renommer chacun de vos villages depuis la vue du village.</li>
          <li>Avec plusieurs villages, choisissez le village actif dans le menu en haut de l'écran.</li>
          <li>Si vous perdez votre dernier village, vous pouvez en fonder un nouveau ailleurs sur la carte.</li>
          <li>
            La page Compte (votre pseudo en haut de l'écran) permet de supprimer définitivement votre compte : vos villages deviennent barbares, vos troupes en route sont perdues, vos rapports et
            messages sont effacés.
          </li>
        </ul>
      </>
    ),
  };
  return <Panel title={title}>{content[id]}</Panel>;
}

// ---------- Bâtiments ----------

function BuildingIndex() {
  const { world } = useGame();
  return (
    <Panel title="Fiches des bâtiments">
      <p className="muted small">Touchez un bâtiment pour voir son coût, sa durée, ses points et son bonus à chaque niveau.</p>
      <div className="wiki-items">
        {BUILDING_KEYS.map((k) => (
          <a key={k} className="wiki-item" href={`#/wiki/batiments/${k}`}>
            <img src={buildingImg(k, 7)} alt="" width={64} height={64} />
            <span>
              <b>{BUILDINGS[k].name}</b>
              <span className="muted small">{BUILDINGS[k].description}</span>
              <span className="small">Prérequis : {requiresText(BUILDINGS[k].requires)}</span>
              <span className="small">Niveau 20 : {bonusAt(k, 20, world.speed)}</span>
            </span>
          </a>
        ))}
      </div>
    </Panel>
  );
}

function BuildingSheet({ k }: { k: BuildingKey }) {
  const { world, village } = useGame();
  const def = BUILDINGS[k];
  const [townhall, setTownhall] = useState(village?.buildings.townhall ?? 1);
  return (
    <Panel title={def.name}>
      <div className="wiki-head">
        <div className="wiki-stages">
          {[1, 7, 14].map((lvl) => (
            <figure key={lvl}>
              <img src={buildingImg(k, lvl)} alt="" width={96} height={96} />
              <figcaption className="muted small">niv. {lvl}+</figcaption>
            </figure>
          ))}
        </div>
        <div>
          <p>{def.description}</p>
          <p><b>Prérequis :</b> {requiresText(def.requires)}</p>
          <p><b>Bonus :</b> {bonusSummary(k, world.speed)}</p>
          <p><b>Points :</b> le niveau N rapporte N points ; total au niveau 20 : {pointsAt(k, def.maxLevel)} points.</p>
        </div>
      </div>
      {k === 'townhall' ? (
        <p className="muted small">Durées à vitesse x{world.speed}. Chaque niveau d'hôtel de ville se construit avec la réduction du niveau précédent.</p>
      ) : (
      <label className="row small">
        Durées calculées avec un hôtel de ville niveau
        <select value={townhall} onChange={(e) => setTownhall(Number(e.target.value))}>
          {LEVELS(BUILDINGS.townhall.maxLevel).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="muted">(vitesse x{world.speed})</span>
      </label>
      )}
      <div className="table-wrap">
        <table className="wiki-table">
          <thead>
            <tr>
              <th>Niv.</th>
              {RESOURCES.map((r) => <th key={r}><ResIcon r={r} size={18} /></th>)}
              <th>Total</th>
              <th>Durée</th>
              <th>Points (+niv.)</th>
              <th>{bonusLabel(k)}</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS(def.maxLevel).map((lvl) => {
              const cost = buildingCost(k, lvl);
              // Pour l'hôtel de ville lui-même, la réduction vient du niveau déjà construit, comme sur le serveur.
              const th = k === 'townhall' ? lvl - 1 : townhall;
              return (
                <tr key={lvl}>
                  <td>{lvl}</td>
                  {RESOURCES.map((r) => <td key={r}>{fmt(cost[r])}</td>)}
                  <td>{fmt(total(cost))}</td>
                  <td>{duration(buildingTime(k, lvl, th, world.speed))}</td>
                  <td>{pointsAt(k, lvl)} (+{pointsAt(k, lvl) - pointsAt(k, lvl - 1)})</td>
                  <td>{bonusAt(k, lvl, world.speed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Troupes ----------

function UnitIndex() {
  const { world } = useGame();
  return (
    <Panel title="Fiches des troupes">
      <p className="muted small">Récapitulatif à vitesse x{world.speed}. Touchez une unité pour sa fiche complète.</p>
      <div className="table-wrap">
        <table className="wiki-table">
          <thead>
            <tr>
              <th>Unité</th>
              <th>Conditions</th>
              <th>Coût</th>
              <th>Attaque</th>
              <th>Déf. inf.</th>
              <th>Déf. cav.</th>
              <th>Butin</th>
              <th>Entretien</th>
            </tr>
          </thead>
          <tbody>
            {UNIT_KEYS.map((k) => {
              const u = UNITS[k];
              return (
                <tr key={k}>
                  <td className="left nowrap">
                    <a href={`#/wiki/troupes/${k}`} className="row nowrap"><UnitIcon unit={k} size={28} /> {u.name}</a>
                  </td>
                  <td className="left small">{requiresText(u.requires)}</td>
                  <td className="left"><Cost cost={u.cost} /></td>
                  <td>{u.attack}</td>
                  <td>{u.defenseInfantry}</td>
                  <td>{u.defenseCavalry}</td>
                  <td>{u.carry}</td>
                  <td>{u.upkeep} blé/h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function UnitSheet({ k }: { k: UnitKey }) {
  const { world } = useGame();
  const u = UNITS[k];
  const note = unitNote(k);
  return (
    <Panel title={u.name}>
      <div className="wiki-head">
        <UnitIcon unit={k} size={112} />
        <div>
          <p>{u.description}</p>
          <p><b>Type :</b> {u.kind === 'cavalry' ? 'cavalerie' : 'infanterie'}</p>
          <p><b>Conditions :</b> {requiresText(u.requires)}</p>
          <p><b>Coût :</b> <Cost cost={u.cost} /> (total {fmt(total(u.cost))})</p>
          {note && <p><b>Spécial :</b> {note}</p>}
        </div>
      </div>
      <dl className="stats wiki-stats">
        <div><dt>Attaque</dt><dd>{u.attack}</dd></div>
        <div><dt>Défense contre l'infanterie</dt><dd>{u.defenseInfantry}</dd></div>
        <div><dt>Défense contre la cavalerie</dt><dd>{u.defenseCavalry}</dd></div>
        <div><dt>Vitesse</dt><dd>{duration((u.speed * 60) / world.speed)} par case</dd></div>
        <div><dt>Butin transporté</dt><dd>{u.carry}</dd></div>
        <div><dt>Entretien</dt><dd>{u.upkeep} blé / h</dd></div>
      </dl>
      <h3>Durée de recrutement (vitesse x{world.speed})</h3>
      <div className="table-wrap">
        <table className="wiki-table">
          <thead>
            <tr><th>Caserne</th>{[1, 5, 10, 15, 20].map((l) => <th key={l}>niv. {l}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>1 unité</td>{[1, 5, 10, 15, 20].map((l) => <td key={l}>{duration(recruitTime(k, l, world.speed))}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Puissance pour 100 unités : attaque {fmt(u.attack * 100)}, défense {fmt(u.defenseInfantry * 100)} contre l'infanterie et {fmt(u.defenseCavalry * 100)} contre la cavalerie, pour{' '}
        {fmt(total(u.cost) * 100)} ressources.
      </p>
    </Panel>
  );
}
