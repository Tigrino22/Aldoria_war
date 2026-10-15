import { useState, type ReactNode } from 'react';
import {
  ARMY_SIGHT,
  BASE_VILLAGE_DEFENSE,
  HOLY_GARRISON,
  HOLY_WALL,
  BEGINNER_PROTECTION_HOURS,
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  HIDDEN_MAX,
  HIDDEN_SHARE,
  LOYALTY_AFTER_CONQUEST,
  LOYALTY_REGEN_PER_HOUR,
  MERCHANT_CAPACITY,
  MERCHANT_SPEED,
  MAX_PLAYER_OFFERS,
  MAX_RATE,
  MIN_OFFER_AMOUNT,
  MIN_RATE,
  OFFER_LIFETIME_HOURS,
  NOBLE_LOYALTY_MAX,
  NOBLE_LOYALTY_MIN,
  ramsToBreakWall,
  RESOURCES,
  RESOURCE_NAMES,
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  UNITS,
  UNIT_KEYS,
  WALL_BONUS_PER_LEVEL,
  CITADEL_WALL,
  CRUSADE_GLORY,
  CRUSADE_SEASON_DAYS,
  CRUSADE_TITLES,
  CRUSADE_TITLE_HELP,
  RELIC_DAYS,
  type CrusadeTitleKey,
  buildingCost,
  buildingTime,
  hiddenResources,
  merchantCount,
  recruitTime,
  populationCapacity,
  ATTACK_WHEAT_PER_POPULATION,
  resourceProduction,
  RESOURCES_PER_POINT,
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
import { PageBanner } from './PageBanner';
import WikiGuide from './WikiGuide';
import './wiki.css';

// Toutes les valeurs affichées ici sont calculées à partir de @aldoria/shared, exactement comme sur le serveur :
// modifier l'équilibrage dans shared/src/config.ts met le wiki à jour automatiquement.

const SECTIONS = [
  { id: 'guide', title: 'Guide du débutant' },
  { id: 'debuter', title: 'Bien débuter' },
  { id: 'ressources', title: 'Ressources et production' },
  { id: 'construction', title: 'Construction' },
  { id: 'armee', title: 'Recrutement et population' },
  { id: 'combat', title: 'Attaque, combat et pillage' },
  { id: 'pillage', title: 'Assistant de pillage' },
  { id: 'espionnage', title: 'Espionnage' },
  { id: 'muraille', title: 'Muraille et béliers' },
  { id: 'conquete', title: 'Nobles et conquête' },
  { id: 'renforts', title: 'Renforts' },
  { id: 'croisades', title: 'Croisades et Citadelle' },
  { id: 'provinces', title: 'Provinces et Terre sainte' },
  { id: 'marche', title: 'Marché et marchands' },
  { id: 'carte', title: 'Carte et villages barbares' },
  { id: 'social', title: 'Rapports, messages, tribus, classement' },
  { id: 'compte', title: 'Compte et villages' },
  { id: 'gestionnaire', title: 'Gestionnaire de compte (pilote automatique)' },
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
  if (key === 'farm') return 'Blé / h · population (places)';
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
  if (key === 'farm') return `${fmt(resourceProduction(level) * speed)} · ${fmt(populationCapacity(level))}`;
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
    const extra =
      key === 'farm'
        ? ` La ferme loge aussi votre armée : chaque soldat occupe des places de population (1 pour un lancier, 4 pour un cavalier). Elle en offre ${fmt(populationCapacity(1))} au niveau 1, soit ${fmt(populationCapacity(1))} lanciers, et ${fmt(populationCapacity(20))} au niveau 20. Chaque attaque emporte aussi ses rations : ${ATTACK_WHEAT_PER_POPULATION} blé par place de population envoyée, rendu si vous annulez.`
        : '';
    return `Produit ${fmt(resourceProduction(1) * speed)} ${RESOURCE_NAMES[RESOURCE_BUILDING[key]!].toLowerCase()} par heure au niveau 1, ${fmt(resourceProduction(20) * speed)} au niveau 20${BUILDINGS[key].maxLevel > 20 ? ` et ${fmt(resourceProduction(BUILDINGS[key].maxLevel) * speed)} au niveau ${BUILDINGS[key].maxLevel}` : ''} (sans bâtiment : ${fmt(resourceProduction(0) * speed)} par heure).${extra}`;
  }
  switch (key) {
    case 'townhall': return 'Chaque niveau au-delà du premier réduit de 5 % la durée de toutes les constructions du village. Il débloque le marché, la caserne et, au niveau 10, le noble.';
    case 'warehouse': return `Fixe la quantité maximale de chaque ressource. Au-delà, la production est perdue. ${pct(HIDDEN_SHARE)} de la capacité est cachée, ${fmt(HIDDEN_MAX)} au plus : les pillards ne peuvent pas la prendre.`;
    case 'market': return `Donne des marchands qui portent chacun ${fmt(MERCHANT_CAPACITY)} ressources vers d'autres villages de joueurs.`;
    case 'barracks': return "Permet de recruter les troupes. Chaque niveau au-delà du premier réduit de 6 % la durée de recrutement et débloque de nouvelles unités.";
    case 'wall': return `Chaque niveau ajoute ${pct(WALL_BONUS_PER_LEVEL)} à la défense de toutes les troupes présentes dans le village, renforts compris.`;
    default: return '';
  }
}

function unitNote(key: UnitKey): string | null {
  switch (key) {
    case 'scout': return "Envoyé seul, il espionne au lieu de combattre. Accompagnant une attaque victorieuse, les éclaireurs survivants rapportent ce qu'il reste dans le village.";
    case 'ram': return `Abaisse la muraille de façon progressive : 1 bélier pour le niveau 1, 2 pour le niveau 2, et ainsi de suite (niveau 20 : ${ramsToBreakWall(20)} béliers au total). Les niveaux sont retirés en partant du plus haut, pendant le combat puis, avec les béliers survivants, après une victoire.`;
    case 'noble': return `Si au moins un noble survit à une attaque victorieuse, la loyauté baisse de ${NOBLE_LOYALTY_MIN} à ${NOBLE_LOYALTY_MAX} points, quel que soit le nombre de nobles de l'attaque. Pour la faire tomber plus vite, envoyez les nobles dans des attaques séparées (train de nobles). À 0, le village est conquis.`;
    default: return null;
  }
}

export default function Wiki({ section, item }: { section?: string; item?: string }) {
  const [, go] = useRoute();
  const { world } = useGame();
  const current = SECTIONS.find((s) => s.id === section)?.id;
  const sectionTitle = SECTIONS.find((s) => s.id === current)?.title;

  return (
    <div className="pg wiki-pg">
      <PageBanner
        icon="wiki"
        kicker={current ? `Wiki · ${sectionTitle}` : "Aide de jeu"}
        title={<>Wiki d'<em>Aldoria War</em></>}
        lead={!current ? 'Les règles du jeu, les fiches des bâtiments et des troupes, calculées directement à partir des règles du serveur.' : undefined}
        chips={<span className="pg-pill gold">Vitesse x{world.speed}</span>}
      />
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
        {current === 'guide' && <WikiGuide />}
        {current && current !== 'batiments' && current !== 'troupes' && current !== 'guide' && <Guide id={current} />}
        {current && (
          <p>
            <button className="btn small ghost" onClick={() => go(item ? `wiki/${current}` : 'wiki')}>
              ← Retour {item ? `aux ${current === 'batiments' ? 'bâtiments' : 'troupes'}` : 'au sommaire'}
            </button>
          </p>
        )}
      </div>
    </div>
    </div>
  );
}

function Home() {
  const { world } = useGame();
  return (
    <Panel title="Sommaire">
      <p>
        Tout ce qu'il faut savoir pour faire grandir votre village. Les chiffres de ce wiki sont calculés directement à partir des règles du jeu, ils sont donc
        toujours à jour. Ce monde tourne en <b>vitesse x{world.speed}</b> : les productions sont multipliées par {world.speed} et les durées divisées par {world.speed}.
      </p>
      <a className="wiki-card wiki-card-featured" href="#/wiki/guide">
        Nouveau sur Aldoria ? Commencez par le guide du débutant
        <span className="muted small">Premiers pas, ordre de construction, pillage, défense et premier noble, pas à pas.</span>
      </a>
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

function Guide({ id }: { id: Exclude<SectionId, 'batiments' | 'troupes' | 'guide'> }) {
  const { world } = useGame();
  const s = world.speed;
  const title = SECTIONS.find((x) => x.id === id)!.title;
  const B = (k: BuildingKey) => <a href={`#/wiki/batiments/${k}`}>{BUILDINGS[k].name}</a>;
  const U = (k: UnitKey) => <a href={`#/wiki/troupes/${k}`}>{UNITS[k].name}</a>;
  const content: Record<typeof id, ReactNode> = {
    debuter: (
      <>
        <p>
          <b>S'orienter :</b> le menu est organisé en groupes (village, armée, carte, social, aide) ; sur téléphone, il s'ouvre depuis le bouton en haut de l'écran.
        </p>
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
        <p>Pour un pas-à-pas complet, voir le <a href="#/wiki/guide">guide du débutant</a>. Conseil de départ : montez les quatre bâtiments de ressources, puis l'{B('townhall')} au niveau 3 pour débloquer la {B('barracks')} et le {B('market')}.</p>
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
          Un bâtiment de ressource produit {fmt(resourceProduction(1) * s)} par heure au niveau 1 et +20 % par niveau, jusqu'à {fmt(resourceProduction(20) * s)} par heure au niveau 20. Le {B('woodcutter')}, l'{B('claypit')} et la {B('ironmine')} montent ensuite jusqu'au niveau {BUILDINGS.woodcutter.maxLevel} (+12 % par niveau environ) : {fmt(resourceProduction(BUILDINGS.woodcutter.maxLevel) * s)} par heure au niveau {BUILDINGS.woodcutter.maxLevel}.
        </p>
        <p>
          <b>Le blé</b> sert à construire et à recruter. Il ne nourrit pas l'armée : la taille de vos troupes est limitée par la population que loge votre {B('farm')}.
        </p>
        <p>
          <b>Stockage :</b> l'{B('warehouse')} fixe le maximum de chaque ressource ({fmt(warehouseCapacity(1))} au niveau 1, {fmt(warehouseCapacity(20))} au niveau 20, {fmt(warehouseCapacity(BUILDINGS.warehouse.maxLevel))} au niveau {BUILDINGS.warehouse.maxLevel}). Une ressource pleine ne produit plus, tout ce qui
          dépasse (production, butin, livraison) est perdu. {pct(HIDDEN_SHARE)} de cette capacité, {fmt(HIDDEN_MAX)} au plus, est cachée et ne peut pas être pillée.
        </p>
      </>
    ),
    construction: (
      <>
        <p>Touchez un emplacement de la vue du village pour construire ou améliorer un bâtiment. Le coût est payé tout de suite.</p>
        <ul>
          <li>La file de construction accepte {BUILD_QUEUE_LIMIT} chantiers à la fois ; le second commence quand le premier est terminé.</li>
          <li>Les bâtiments montent jusqu'au niveau 20, sauf les trois mines et l'{B('warehouse')} (niveau {BUILDINGS.woodcutter.maxLevel}) et la {B('barracks')} (niveau {BUILDINGS.barracks.maxLevel}). Le coût est multiplié par 1,25 ou 1,26 et la durée par 1,2 à chaque niveau.</li>
          <li>Chaque niveau d'{B('townhall')} au-delà du premier réduit de 5 % la durée de toutes les constructions.</li>
          <li>Certains bâtiments ont des prérequis : {B('market')} ({requiresText(BUILDINGS.market.requires)}), {B('barracks')} ({requiresText(BUILDINGS.barracks.requires)}), {B('wall')} ({requiresText(BUILDINGS.wall.requires)}).</li>
          <li>Chaque niveau rapporte des points de classement : un point pour {fmt(RESOURCES_PER_POINT)} ressources dépensées. Les points suivent donc le vrai poids du village, et les derniers niveaux, très chers, en rapportent beaucoup.</li>
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
            <b>Population :</b> chaque unité occupe des places de population, offertes par la {B('farm')}. On ne peut recruter que s'il reste assez de places pour toute l'armée,
            recrues et troupes parties au combat comprises. Le blé reste une ressource comme les autres.
          </li>
          <li>
            <b>Dissolution :</b> depuis le Point de ralliement, le bouton « Dissoudre » renvoie des soldats stationnés dans le village à la vie civile. L'action est définitive et ne rembourse rien,
            mais les places de population qu'ils occupaient sont immédiatement libérées. Seules les troupes présentes au village peuvent être dissoutes (pas celles en mouvement ni en renfort chez un autre).
          </li>
          <li>
            <b>Ordres du Point de ralliement :</b> on y envoie une attaque ou un soutien vers des coordonnées, tout de suite ou pour une heure d'arrivée précise : les troupes sont alors réservées et partent seules à l'heure
            qui convient, et l'on peut annuler l'ordre tant qu'il n'est pas parti. Le Point de ralliement est une page à part du menu (distincte de « Troupes ») ; depuis la carte, « Ouvrir au point de ralliement » y mène avec la cible déjà remplie. Les unités les plus rapides partent plus tard que les lentes pour que tous les mouvements arrivent à l'heure choisie.
          </li>
          <li>
            <b>Assistant de pillage :</b> une page dédiée pour piller les villages barbares en un clic, avec deux modèles de troupes. Voir <a href="#/wiki/pillage">le guide de l'assistant de pillage</a>.
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
    pillage: (
      <>
        <p>
          L'entrée <b>« Assistant de pillage »</b> du menu liste les villages barbares autour de votre village actif et permet de les attaquer en un clic, sans repasser par la carte ni ressaisir les troupes.
        </p>
        <h3>Mode d'emploi</h3>
        <ol>
          <li>
            <b>Enregistrez vos modèles.</b> Il y a deux modèles d'attaque, <b>A</b> et <b>B</b> : indiquez le nombre de chaque unité à envoyer puis « Enregistrer ». Par exemple A pour de petits pillages
            rapides à la cavalerie légère, B pour un gros détachement face à un village mieux défendu. Les modèles sont mémorisés sur votre appareil.
          </li>
          <li>
            <b>Choisissez le rayon</b> (10, 20 ou 30 cases autour du village actif) et le tri : distance, points, butin estimé ou dernier butin.
          </li>
          <li>
            <b>Cliquez sur A ou B</b> à côté d'un village pour l'attaquer avec ce modèle. Pour en attaquer plusieurs, cochez-les puis utilisez « Envoyer A » ou « Envoyer B » en bas de page : l'envoi
            s'arrête quand il ne reste plus assez de troupes dans le village.
          </li>
        </ol>
        <h3>Ce que vous voyez sur chaque village</h3>
        <ul>
          <li>
            <b>Butin estimé</b> (« ≈ 1 240 pillables ») : calculé d'après votre <b>dernier rapport où un éclaireur a vu les réserves</b> du village (un espionnage réussi, ou des éclaireurs survivants
            d'une attaque victorieuse). On ajoute la production depuis ce rapport (dans la limite de l'{B('warehouse')}), puis on retire vos pillages arrivés depuis et la cachette, que l'on ne peut
            pas voler. C'est une estimation : survolez-la pour le détail par ressource.
          </li>
          <li>
            <b>« ? à espionner »</b> : aucun éclaireur n'a encore vu ce village. Envoyez-y quelques {U('scout')}s pour obtenir une estimation.
          </li>
          <li>
            <b>Attaque suicidaire</b> : d'après ce que vous savez de sa défense (muraille comprise), le modèle indiqué perdrait. Le bouton correspondant passe en rouge. Cette information peut être périmée : la défense a pu changer depuis.
          </li>
          <li>
            <b>La pastille</b> donne le résultat de votre dernière attaque : gris, jamais attaqué ; bleu, espionné ; rouge, attaque perdue ; jaune, victoire avec pertes ; vert, victoire sans perte.
          </li>
          <li>
            <b>Villages masqués</b> : dès qu'une de vos attaques est en route vers un village, il disparaît de la liste jusqu'à son arrivée, pour éviter d'envoyer deux fois des troupes au même endroit.
          </li>
        </ul>
        <p>Pour les règles du combat et du pillage, voir <a href="#/wiki/combat">Attaque, combat et pillage</a>.</p>
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
          <li>Le coût est progressif : le niveau N de muraille demande N béliers, en partant du niveau le plus haut. Une muraille de niveau 3 tombe d'un niveau avec 3 béliers, puis d'un autre avec 2, puis le dernier avec 1.</li>
          <li>Abattre une muraille de niveau 10 demande {ramsToBreakWall(10)} béliers, de niveau 20 : {ramsToBreakWall(20)}.</li>
          <li>Pendant le combat, la muraille compte ces niveaux en moins pour les béliers envoyés.</li>
          <li>Après une victoire, les béliers survivants détruisent réellement ces niveaux (le défenseur perd aussi les points correspondants).</li>
        </ul>
      </>
    ),
    conquete: (
      <>
        <p>Chaque village a une loyauté de 100. Pour prendre un village (joueur ou barbare), il faut l'attaquer avec des {U('noble')}s.</p>
        <ul>
          <li>Si l'attaque est victorieuse et qu'au moins un noble survit, la loyauté baisse de {NOBLE_LOYALTY_MIN} à {NOBLE_LOYALTY_MAX} points (tirage au hasard), quel que soit le nombre de nobles : un seul tirage par attaque. Pour conquérir plus vite, lancez un train de nobles : une attaque par noble.</li>
          <li>
            <b>Train de nobles :</b> le Point de ralliement l'organise : l'assaut nettoie la défense, puis chaque noble part dans sa propre attaque, une seconde après le précédent. Un noble seul ne survit pas à la
            défense de base d'un village : vous choisissez les troupes et leur quantité qui escortent chaque noble (2 épéistes par défaut). S'il n'y a pas assez de troupes pour tous les nobles demandés (3 escortes possibles sur 4, par exemple), seules 3 attaques partent.
          </li>
          <li>La loyauté remonte de {fmt(LOYALTY_REGEN_PER_HOUR * s)} point{LOYALTY_REGEN_PER_HOUR * s > 1 ? 's' : ''} par heure, jusqu'à 100.</li>
          <li>À 0, le village est à vous : sa loyauté repart à {LOYALTY_AFTER_CONQUEST}, un noble s'y installe pour gouverner (il disparaît de l'armée) et les autres survivants deviennent la garnison.</li>
          <li>L'ancien propriétaire perd les constructions et recrutements en cours ainsi que toutes les troupes de ce village, y compris celles qui étaient en dehors.</li>
          <li>Un village conquis n'est pas pillé.</li>
        </ul>
      </>
    ),
    croisades: (
      <>
        <p>
          Deux soirs par semaine (par défaut le mercredi et le samedi à 20 h 30), une <b>Citadelle</b> surgit sur la carte. Elle est annoncée deux jours avant, puis ses portes restent ouvertes une heure. La{' '}
          <a href="#/croisade">page Croisades</a> affiche le compte à rebours, la muraille, le camp qui tient la bannière, la chronique et la gloire de chacun.
        </p>
        <ul>
          <li>
            <b>Garnison :</b> lanciers, hallebardiers et épéistes, une fois et demie l'armée offensive de la plus forte tribu du monde, en place dès l'annonce. Pendant l'assaut, tant qu'aucune bannière ne flotte, la Garde envoie toutes les 15 minutes des renforts (15 % de la garnison de départ) : il faut enchaîner les vagues et planter vite la bannière. La muraille est au niveau {CITADEL_WALL} : il faut des {U('ram')} pour l'abattre.
          </li>
          <li>
            <b>Fenêtre d'assaut :</b> attaques et renforts doivent <b>arriver</b> pendant l'heure d'ouverture, sinon ils font demi-tour. Les {U('scout')} peuvent partir dès l'annonce. Le{' '}
            <a href="#/ralliement">point de ralliement</a> programme une arrivée à la seconde près.
          </li>
          <li>
            <b>Bannière :</b> l'attaque qui vide la Citadelle doit compter un {U('noble')} survivant pour planter la bannière de son camp (votre tribu et ses alliées, ou vous seul). Ses troupes restent alors en
            garnison. Seul ce camp peut envoyer des renforts ; ses attaques deviennent des renforts. Les autres camps peuvent la reprendre.
          </li>
          <li>
            <b>Victoire :</b> le camp qui tient la bannière à la fermeture des portes gagne. Toutes les troupes rentrent et les ordres programmés pas encore partis sont annulés.
          </li>
        </ul>
        <p>
          <b>Gloire :</b> 1 par {CRUSADE_GLORY.killsPerGlory} places de population ennemies tuées (en attaque comme en défense), +{CRUSADE_GLORY.breach} pour la brèche, +{CRUSADE_GLORY.capture} par bannière plantée et +
          {CRUSADE_GLORY.victory} pour chaque membre du camp vainqueur qui a combattu (un quart de moins à chaque victoire d'affilée de la même tribu). Le{' '}
          <a href="#/classement/gloire">classement de gloire</a> repart de zéro tous les {CRUSADE_SEASON_DAYS} jours.
        </p>
        <p>
          <b>Récompenses :</b> la <b>relique</b> augmente la production de tous les villages du camp vainqueur pendant {RELIC_DAYS} jours (bannière dorée sur la carte) ; le <b>trésor</b> de la Citadelle est partagé
          entre tous les combattants selon leur gloire et livré à leur plus ancien village ; des <b>titres</b> à choisir dans <a href="#/compte">Mon compte</a> s'affichent à côté de votre nom :
        </p>
        <ul>
          {(Object.keys(CRUSADE_TITLES) as CrusadeTitleKey[]).map((k) => (
            <li key={k}>
              <b>{CRUSADE_TITLES[k]}</b> : {CRUSADE_TITLE_HELP[k].charAt(0).toLowerCase() + CRUSADE_TITLE_HELP[k].slice(1)}.
            </li>
          ))}
        </ul>
        <p>
          <b>Les PNJ aussi :</b> les tribus de PNJ espionnent la Citadelle dès l'annonce, s'engagent si leur armée est assez forte, gardent leurs troupes en réserve et programment des vagues échelonnées, puis
          renforcent ou contre-attaquent selon le camp qui tient la bannière.
        </p>
      </>
    ),
    provinces: (
      <>
        <p>
          Le monde est découpé en <b>provinces</b> de tailles et de formes variées, avec la <b>Terre sainte</b> en son centre. Leurs frontières dorées se voient sur la carte (bouton « Provinces » pour
          les masquer) ; la <a href="#/provinces">page Provinces</a> montre qui tient quoi, le bonus de chaque province et les valeurs de ce monde.
        </p>
        <ul>
          <li>
            <b>Bastion :</b> chaque province a un fort, gardé au départ par une garnison neutre derrière une muraille. Il est ouvert jour et nuit.
          </li>
          <li>
            <b>Trois niveaux :</b> plus une province est proche de la Terre sainte, plus son bastion est dur et son bonus fort. Par défaut : niveau 1 au bord de la carte ({fmt(1500)} places de garde, muraille 5,
            bonus +5 %), niveau 2 à mi-chemin ({fmt(3000)}, muraille 10, +10 %), niveau 3 autour de la Terre sainte ({fmt(6000)}, muraille 15, +15 %). La page Provinces donne les valeurs de ce monde.
          </li>
          <li>
            <b>Trésor :</b> quand votre tribu prend le contrôle d'une province, chaque membre reçoit dans son <a href="#/inventaire">inventaire</a> un trésor qui remplit une part de l'entrepôt du
            village de son choix (par défaut 10 %, 20 % ou 30 % selon le niveau), une seule fois par province.
          </li>
          <li>
            <b>Bannière :</b> l'attaque qui vide le bastion doit compter un {U('noble')} survivant pour planter la bannière de votre tribu ; vos survivants restent pour le garder. Sans tribu, pas de
            bannière. Votre tribu et ses alliées peuvent le renforcer, et leurs attaques deviennent des renforts.
          </li>
          <li>
            <b>Contrôle :</b> après la durée de tenue (12 heures par défaut) sans perdre la bannière, la province est contrôlée : son bonus (bois, argile, fer ou blé en plus, recrutement plus rapide ou
            troupes plus rapides, selon le niveau) s'applique à tous les villages de la tribu. Les provinces s'additionnent.
          </li>
          <li>
            <b>Perte :</b> une attaque victorieuse avec un noble remplace la bannière, sans noble elle l'abat ; la tribu qui la tenait perd le bonus tout de suite.
          </li>
          <li>
            <b>Terre sainte :</b> son Sanctuaire ({fmt(HOLY_GARRISON)} places de garnison, muraille {HOLY_WALL}) ne peut être attaqué que par une tribu qui contrôle assez de provinces de niveau 3, celles qui la bordent (2 par défaut) ;
            les {U('scout')} y vont librement. La tribu qui y garde sa bannière assez longtemps (3 jours par défaut) <b>gagne le monde</b> : ses membres reçoivent le titre « Maître d’Aldoria ».
          </li>
        </ul>
        <p>La Citadelle des Croisades reste un événement à part : elle ne donne pas accès à la Terre sainte.</p>
      </>
    ),
    renforts: (
      <>
        <p>« Envoyer un renfort » envoie des troupes défendre un autre village : un des vôtres ou celui d'un allié.</p>
        <ul>
          <li>Les renforts combattent avec la garnison et profitent de la muraille du village qui les accueille.</li>
          <li>Leurs places de population restent occupées dans leur village d'origine.</li>
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
        <h3>Offres du marché</h3>
        <p>
          L'onglet « Offres » (aussi dans le menu, « Offres du marché ») permet d'échanger avec les autres joueurs sans connaître leur pseudo : vous publiez ce que vous donnez et ce que vous voulez en échange, et
          n'importe quel joueur peut accepter.
        </p>
        <ul>
          <li>Les ressources que vous donnez sont retirées de votre entrepôt dès la publication (il faut aussi assez de marchands libres pour les livrer) ; elles vous reviennent si l'offre est annulée ou expire. Ces marchands restent réservés tant que l'offre est ouverte : vous ne pouvez pas les utiliser pour une autre offre ou un envoi.</li>
          <li>Le taux (ce que vous demandez ÷ ce que vous donnez) doit rester entre {MIN_RATE} et {MAX_RATE}, et chaque quantité fait au moins {MIN_OFFER_AMOUNT}. Une pastille « 1 : x » indique le taux de chaque offre.</li>
          <li>Une offre dure {duration((OFFER_LIFETIME_HOURS * 3600) / s)} ; passé ce délai elle expire et vos ressources reviennent.</li>
          <li>Vous pouvez avoir {MAX_PLAYER_OFFERS} offres ouvertes en même temps et les retirer à tout moment depuis « Mes offres ».</li>
          <li>Les filtres « Je veux » et « J'offre » trient la liste par ressource </li>
        </ul>
        <p>
          <b>Les PNJ commercent aussi :</b> sans limite de distance ni de nombre d'offres, ils rééquilibrent en permanence leurs ressources avec tous leurs marchands libres : ils publient une offre pour une ressource en excédent contre une qui leur manque, et acceptent les vôtres quand elles les arrangent. Leurs offres ne se distinguent pas de celles des joueurs.
        </p>
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
          Les villages barbares ne recrutent pas : une garnison vaincue ne revient pas, mais leurs bâtiments gagnent des niveaux avec le temps. Les plus lointains sont aussi les mieux défendus.
        </p>
        <p>
          Touchez un village sur la carte pour voir son propriétaire, ses points et lui envoyer des troupes ou des marchands. À la souris, il suffit de survoler un village : la même fiche
          s'affiche, avec le temps de trajet de chaque unité depuis votre village actif. Le pseudo d'un joueur ouvre son profil et la liste de ses villages.
        </p>
        <p>
          De petits médaillons en haut à droite d'un village signalent les mouvements en route vers lui : deux épées croisées pour une attaque, un écu pour un soutien. Vous voyez
          ceux que vous avez envoyés et ceux qui visent vos villages ; une attaque ennemie qui arrive chez vous a son médaillon en rouge.
        </p>
        <p>
          <b>Armées en marche :</b> vos mouvements, ceux de votre tribu et de vos alliés se voient de bout en bout, comme le trajet des attaques et renforts qui visent vos villages. Une armée
          étrangère n'est <b>repérée</b> qu'à {ARMY_SIGHT} cases ou moins de l'un de vos villages : c'est seulement là qu'on voit sa composition (une attaque qui vous vise reste visible de loin,
          mais son contenu est caché jusque-là). Touchez une armée pour ouvrir sa fiche.
        </p>
        <p>
          <b>Interception :</b> une armée ennemie repérée peut être attaquée en chemin. Choisissez vos troupes dans sa fiche : le point et l'heure de rencontre s'affichent. Lancée pendant qu'elle est
          à {ARMY_SIGHT} cases ou moins de vos villages, l'interception la <b>poursuit</b> jusqu'à la rattraper, même si elle sort ensuite de la zone (tant qu'elle n'est pas arrivée) ;
          lancée avant qu'elle n'approche, la rencontre doit avoir lieu dans la zone. On s'y bat en rase campagne, sans muraille ; les survivants adverses poursuivent leur route, et une armée détruite laisse
          son butin à vos troupes. L'envoi coûte des rations comme une attaque. Attention : les PNJ font de même, et peuvent attaquer en chemin vos armées
          qui passent près de leurs villages.
        </p>
        <p>
          <b>Couleurs :</b> jaune pour vos villages, blanc pour votre village actif, bleu pour votre tribu, bleu ciel pour les tribus alliées, rouge vif pour les tribus en guerre déclarée avec la
          vôtre, rouge foncé pour les autres joueurs et gris pour les barbares. Ces couleurs sont fixes. Le bouton « Couleurs » permet d'ajouter des repères : un joueur ou une tribu précise prend la
          couleur de votre choix sur la carte et la mini-map (les couleurs fixes restent prioritaires). Les repères sont gardés sur votre appareil.
        </p>
        <p>
          <b>Se repérer :</b> « Quadrillage » affiche une grille de 10 cases avec leurs coordonnées, « Mini-map » une vue d'ensemble du monde où vous cliquez pour vous déplacer, et le champ
          « x|y » saute directement à une case. En dézoomant, les villages deviennent des pastilles colorées pour voir tout le monde d'un coup d'œil.
          La carte se manipule au doigt (glisser, pincer) comme à la souris.
        </p>
        <p>
          <b>Joueurs PNJ :</b> certains comptes sont pilotés par le serveur. Ils construisent, recrutent, commercent, rejoignent des tribus et attaquent comme n'importe quel joueur, avec les mêmes règles.
          Pour laisser les nuits tranquilles, aucun PNJ ne vise de joueur entre 22 h et 8 h (heure de Paris) : pas d'attaque ni d'espionnage, et aucune troupe ne doit arriver chez vous à ces heures.
          Ils peuvent en revanche piller les villages barbares à toute heure. Hors heures calmes, un PNJ ne s'en prend sans raison qu'à un joueur de force comparable (70 à 150 % de ses points),
          jamais à un joueur sous protection débutant, mais il riposte contre qui l'a attaqué, lui ou sa tribu.
        </p>
        <p>
          <b>Offensives des PNJ :</b> de temps en temps (environ une fois par jour de jeu), un village offensif de PNJ espionne une cible puis lui envoie la moitié de son armée : un joueur de force comparable,
          un ennemi de guerre ou une tribu rivale. Si cette moitié ne suffit pas à battre la défense espionnée, toute l'armée offensive part à la place ; si même elle ne suffit pas, l'offensive est annulée. Un PNJ ne lance plus d'attaque perdue d'avance. Un joueur ne subit pas plus d'une offensive par période,
          jamais pendant les heures calmes ni sous protection débutant. L'administration peut la couper, ou régler la part de l'armée et le rythme.
        </p>
        <p>
          <b>Riposte et guerres des PNJ :</b> si la riposte est activée sur le monde, un PNJ attaqué par un joueur lui en veut pendant 3 jours, de même que les PNJ de sa tribu et des tribus alliées.
          Si le joueur appartient à une tribu, la tribu du PNJ lui déclare en plus la guerre pour 4 jours. Indépendamment de la riposte, les tribus de PNJ se font la guerre entre elles
          et peuvent aussi déclarer la guerre à une tribu de joueurs sans provocation (4 jours, puis une trêve de plusieurs jours). Pendant une guerre, leurs membres frappent les villages ennemis, même éloignés,
          mais jamais pendant les heures calmes ni un joueur sous protection débutant. Chaque village de PNJ a un rôle, offensif ou défensif : seuls les villages offensifs partent en attaque,
          les défensifs gardent leurs troupes pour protéger la tribu. Les guerres et la riposte se coupent séparément depuis l'administration du monde.
        </p>
      </>
    ),
    social: (
      <>
        <h3>Rapports</h3>
        <p>Attaques, défenses, espionnages, renforts et livraisons créent un rapport. Un badge indique les rapports non lus ; vous pouvez les supprimer.</p>
        <h3>Messages</h3>
        <p>Écrivez à n'importe quel joueur en donnant son pseudo, ou depuis son profil. Vous êtes prévenu en direct à la réception. « Répondre » prépare un message au correspondant de la conversation.</p>
        <h3>Tribus</h3>
        <ul>
          <li>Fondez une tribu avec un nom (3 à 32 caractères) et un tag (2 à 6 lettres ou chiffres), ou rejoignez-en une sur invitation.</li>
          <li>Le chef invite, exclut et rédige la description de la tribu. Pour inviter, il ouvre le profil du joueur (en touchant son pseudo) et utilise le bouton « Inviter dans ma tribu » : ce bouton n'apparaît que pour le chef, et seulement si le joueur est libre et n'a pas déjà reçu d'invitation.</li>
          <li>On ne peut appartenir qu'à une tribu à la fois.</li>
          <li>La page de tribu propose aux membres trois outils : les menaces (attaques extérieures en approche sur les villages de la tribu), les attaques en cours des membres (cible, heure d'arrivée et nature de chaque attaque, sans les effectifs) et un message envoyé à toute la tribu.</li>
          <li>
            <b>Alliances :</b> le chef propose une alliance à une autre tribu de joueurs depuis l'onglet « Alliances » de la page Tribu (ou le bouton « Proposer une alliance » sur la page de cette tribu). Le chef d'en face
            l'accepte ou la refuse ; une seule proposition à la fois entre deux tribus, jamais avec une tribu en guerre contre vous ni avec une tribu de PNJ, et 5 alliées au plus. L'alliance est réciproque :
            les villages des alliés apparaissent en bleu ciel sur la carte et ne peuvent pas être visés par une déclaration de guerre. L'un ou l'autre chef peut la rompre à tout moment ; les membres des deux tribus sont prévenus.
          </li>
          <li>
            <b>Guerres :</b> l'onglet « Guerres » de la page Tribu liste les guerres de votre tribu (déclarées par vous ou contre vous) avec le temps restant. Le chef peut déclarer la guerre à une tribu de joueurs ou de PNJ pour 4 jours
            (3 guerres déclarées à la fois au plus) et y mettre fin quand il veut. Une tribu de PNJ peut aussi vous déclarer la guerre sans provocation, ou en riposte quand l'un des vôtres attaque un de ses membres (si la riposte est activée) : ses membres frappent alors les villages de votre tribu, jamais pendant les
            heures calmes, et vous êtes prévenus par message. Entre deux tribus de joueurs, la guerre est un état déclaré, visible des deux camps.
            Chaque guerre affiche son bilan depuis la déclaration, pour votre tribu et pour l'adversaire : batailles gagnées (en attaque et en défense), villages conquis et adversaires battus. Un panneau « Statistiques de guerre » totalise les guerres en cours et celles de la semaine, et classe les cinq meilleurs guerriers de votre tribu.
            La page « Guerres du monde » (menu Social) est ouverte à tous : fronts en cours entre toutes les tribus, batailles et conquêtes des dernières heures (jusqu'à 72 h), rythme par heure, journal des déclarations et tribus de PNJ en trêve. Les attaques en route n'y sont pas détaillées.
          </li>
        </ul>
        <h3>Vue d'ensemble et aides à l'attaque</h3>
        <p>
          La vue d'ensemble liste tous vos villages (ressources, constructions, troupes, mouvements). Avant un envoi, la simulation estime le résultat d'un combat à partir de ce que vos éclaireurs ont appris, et vous
          pouvez enregistrer des modèles d'armée pour les réutiliser.
        </p>
        <h3>Classement</h3>
        <p>La page Classement a trois onglets, chacun pour les joueurs et pour les tribus (les chiffres d'une tribu sont la somme de ceux de ses membres) :</p>
        <ul>
          <li><b>Joueurs et Tribus :</b> classement général par points, avec deux variantes, « Attaque » et « Défense », qui comptent les adversaires battus.</li>
          <li><b>Guerre :</b> classement de guerre (conquêtes, villages perdus, victoires), podium, dernières conquêtes du monde et guerres de tribus en cours.</li>
          <li>La page « Statistiques du monde », dans le menu Social, donne les totaux et moyennes de toute la carte.</li>
        </ul>
        <p>
          Les points d'un joueur sont la somme des points de ses villages, et ceux d'un village les ressources investies dans ses bâtiments : un point pour {fmt(RESOURCES_PER_POINT)} ressources (bois, argile, fer et blé). Le
          classement des tribus additionne les points de leurs membres.
        </p>
        <p>
          Deux autres classements, pour les joueurs comme pour les tribus, comptent les adversaires battus : chaque troupe ennemie tuée vaut ses places de population (un lancier 1, un cavalier 4).
          « Attaque » compte les troupes tuées quand vous attaquez, « Défense » celles tuées quand on vous attaque (les renforts partagent ce total avec le propriétaire du village, selon leur poids). Ces chiffres
          figurent sur les profils des joueurs et des tribus. Seuls les combats livrés depuis la mise en place de ces classements sont comptés.
        </p>
        <p>
          <b>Classement de guerre :</b> l'onglet « Guerre » classe joueurs et tribus (la somme de leurs membres) selon un score de guerre : 250 points par village conquis à un adversaire (joueur ou PNJ, jamais un village barbare),
          5 points par victoire contre un village occupé (une attaque réussie, ou une attaque repoussée quand on vous attaque ; les espionnages ne comptent pas), et 1 point par 50 d'adversaires battus. Le tableau montre aussi les villages perdus. Un podium met les trois premiers en avant,
          et deux listes donnent les dernières conquêtes du monde et les guerres de tribus en cours. 
        </p>
        <h3>Statistiques du monde</h3>
        <p>
          La page « Statistiques du monde » (menu Social) est ouverte à tous les joueurs : nombre de joueurs, de PNJ, de tribus et de villages, points moyens par village, activité des dernières 24 heures (attaques, conquêtes, joueurs actifs),
          troupes et ressources de tout le monde, taille des villages et niveau moyen des bâtiments. Ce ne sont que des totaux et des moyennes : jamais le détail d'un joueur ou d'un village, ni leurs troupes ou leurs ressources.
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
    gestionnaire: (
      <>
        <p>
          Le <b>gestionnaire de compte</b> est un pilote automatique : vous fixez une fois ce que chaque village doit construire et recruter, et il le fait à votre place, dès que les ressources le
          permettent, même quand vous n'êtes pas connecté. Vous gardez vos connexions pour la stratégie militaire. Il se trouve dans le menu, sous « Gestionnaire de compte », et chaque village de
          « Mes villages » a aussi son interrupteur.
        </p>
        <p><b>Comment ça marche</b></p>
        <ul>
          <li>Toutes les minutes, le gestionnaire regarde chaque village dont l'interrupteur est sur « Actif ».</li>
          <li>
            Il agit exactement comme vous le feriez à la main : mêmes coûts, mêmes prérequis, même file de {BUILD_QUEUE_LIMIT} constructions, même limite de population de la {B('farm')}. Il n'a aucun
            avantage sur un joueur connecté.
          </li>
          <li>Il ne retire jamais de troupes, n'annule rien et ne touche ni au marché ni aux attaques : il construit et recrute seulement.</li>
        </ul>
        <p><b>Les modèles</b></p>
        <p>
          Un modèle est un réglage que vous pouvez appliquer à plusieurs villages. Deux modèles vous sont donnés au départ, réglés pour faire grandir le village le plus vite possible puis remplir toute la
          ferme : « Offensif » (épéistes, cavaliers, béliers, éclaireurs) et « Défensif » (lanciers, hallebardiers, muraille 20). Vous pouvez les modifier, en créer d'autres (10 au maximum) ou les supprimer. Un modèle contient :
        </p>
        <ul>
          <li>
            <b>Une liste de bâtiments, par ordre de priorité,</b> chacun avec son niveau cible. Le gestionnaire monte le premier bâtiment de la liste qui n'a pas atteint son niveau. Un même bâtiment peut
            revenir plusieurs fois (par exemple ferme 8, caserne 10, puis ferme 20). Si un prérequis manque (une {B('barracks')} pour la {B('wall')}, un {B('townhall')} assez haut…), il construit d'abord
            le prérequis, et l'{B('warehouse')} si le niveau coûte plus que ce qu'il peut contenir.
          </li>
          <li>
            <b>Un effectif voulu par unité.</b> Les troupes déjà au village, en déplacement et en cours de recrutement comptent dans l'effectif. Le gestionnaire recrute celles qui sont le plus en retard
            sur leur objectif, par lots d'au plus deux heures de recrutement, pour que la file reste réactive. Il demande une {B('barracks')} et les prérequis de chaque unité, comme à la main.
          </li>
          <li>
            <b>Le curseur « part de la production pour les troupes »</b> (voir plus bas).
          </li>
        </ul>
        <p><b>Bâtiments ou troupes : qui passe d'abord ?</b></p>
        <p>
          Un bâtiment coûte presque toujours bien plus cher que quelques soldats. Sans précaution, les troupes dépenseraient tout dès qu'elles le peuvent et le bâtiment n'aurait jamais ses ressources. Le
          gestionnaire met donc de côté le coût du prochain bâtiment, et les troupes utilisent le reste. Le curseur règle la part de la production que les troupes peuvent quand même prendre sur cette réserve :
        </p>
        <ul>
          <li><b>0 %</b> : bâtiments d'abord. Les troupes n'utilisent que l'excédent, donc rien ne part tant que le bâtiment n'est pas payé.</li>
          <li><b>15 à 25 %</b> (Offensif 15 %, Défensif 25 %) : les troupes avancent déjà pendant que le bâtiment se prépare, et le bâtiment arrive toujours, avec seulement un peu de retard.</li>
          <li><b>100 %</b> : troupes d'abord, rien n'est réservé pour les bâtiments.</li>
        </ul>
        <p>
          Quand un bâtiment attend ses ressources, le gestionnaire ne passe jamais au suivant : sinon les petits bâtiments mangeraient tout et les gros ne seraient jamais construits. Le message « en
          attente » de « Mes villages » vous dit ce qui manque. Si le coût d'un bâtiment dépasse la capacité de l'{B('warehouse')}, l'entrepôt est monté d'abord.
        </p>
        <p><b>Types de village</b></p>
        <p>
          Choisissez le modèle de chaque village dans « Mes villages » ou dans la page du gestionnaire : « Offensif » pour vos villages d'attaque, « Défensif » pour ceux qui tiennent les troupes en
          défense, ou un modèle de votre création. Le bouton « Personnaliser ce village » règle un village sans toucher au modèle ; « Suivre le modèle » revient au modèle.
        </p>
        <p><b>Bon à savoir</b></p>
        <ul>
          <li>Un village n'est pas confié au gestionnaire tant que vous n'avez pas activé son interrupteur. Les nouveaux villages démarrent arrêtés.</li>
          <li>Si un village est conquis par un autre joueur, ses réglages disparaissent.</li>
          <li>Si vous supprimez un modèle, les villages qui le suivaient n'ont plus de modèle : le gestionnaire les laisse tranquilles jusqu'à ce que vous en choisissiez un.</li>
          <li>L'administrateur peut désactiver le gestionnaire pour tout le monde. Vos réglages sont alors conservés, mais rien ne s'exécute.</li>
          <li>Le journal de chaque village garde les dernières actions (« Ferme niveau 12 lancé », « 120 lanciers en recrutement »).</li>
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
          <p><b>Points :</b> un point pour {fmt(RESOURCES_PER_POINT)} ressources dépensées ; total au niveau {def.maxLevel} : {fmt(pointsAt(k, def.maxLevel))} points.</p>
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
                  <td>{fmt(pointsAt(k, lvl))} (+{fmt(pointsAt(k, lvl) - pointsAt(k, lvl - 1))})</td>
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
              <th>Population</th>
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
                  <td>{u.population}</td>
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
        <div><dt>Population</dt><dd>{u.population}</dd></div>
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
