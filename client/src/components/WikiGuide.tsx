import {
  BASE_VILLAGE_DEFENSE,
  BEGINNER_PROTECTION_HOURS,
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  HIDDEN_MAX,
  HIDDEN_SHARE,
  MERCHANT_CAPACITY,
  NOBLE_LOYALTY_MAX,
  NOBLE_LOYALTY_MIN,
  QUESTS,
  RESOURCES,
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  UNITS,
  WALL_BONUS_PER_LEVEL,
  buildingCost,
  emptyResources,
  hiddenResources,
  populationCapacity,
  ATTACK_WHEAT_PER_POPULATION,
  resourceProduction,
  wallBonus,
  warehouseCapacity,
  type BuildingKey,
  type Buildings,
  type Resources,
  type UnitKey,
} from '@aldoria/shared';
import { duration, fmt } from '../format';
import { useGame } from '../game';
import { Cost, Panel } from '../ui';

// Guide du débutant du wiki. Comme le reste du wiki, chaque chiffre est calculé depuis @aldoria/shared :
// un rééquilibrage dans shared/src/config.ts met ce guide à jour tout seul.

const B = (k: BuildingKey) => <a href={`#/wiki/batiments/${k}`}>{BUILDINGS[k].name}</a>;
const U = (k: UnitKey, plural = false) => <a href={`#/wiki/troupes/${k}`}>{UNITS[k].name}{plural ? 's' : ''}</a>;
const sumRes = (a: Resources, b: Resources): Resources => ({ wood: a.wood + b.wood, clay: a.clay + b.clay, iron: a.iron + b.iron, wheat: a.wheat + b.wheat });
const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${String(Math.round(h * 10) / 10).replace('.', ',')} h`);
/** Part des troupes perdues par le vainqueur, avec la formule de combat : (force du perdant ÷ force du gagnant)^1,5. */
const lossShare = (ratio: number) => `${Math.round(Math.pow(1 / ratio, 1.5) * 100)} %`;
/** Plus petit niveau d'entrepôt capable de stocker `amount` d'une ressource. */
const warehouseFor = (amount: number) => {
  for (let lvl = 1; lvl <= BUILDINGS.warehouse.maxLevel; lvl++) if (warehouseCapacity(lvl) >= amount) return lvl;
  return BUILDINGS.warehouse.maxLevel;
};

/** Ordre de construction conseillé, par étapes. Chaque étape donne des niveaux cibles. */
const PHASES: { title: string; when: string; targets: Partial<Buildings>; why: string }[] = [
  {
    title: '1. Lancer la production',
    when: 'Les premières heures',
    targets: { woodcutter: 3, claypit: 3, ironmine: 3, farm: 3, warehouse: 2, townhall: 3 },
    why: "Les bâtiments de ressources sont votre moteur : chaque niveau produit plus, pour toujours. L'hôtel de ville 3 ouvre la caserne et le marché. Ces étapes valident aussi les premières quêtes.",
  },
  {
    title: '2. Premières défenses',
    when: 'Avant la fin de la protection',
    targets: { barracks: 2, wall: 1, woodcutter: 5, claypit: 5, ironmine: 5, warehouse: 4 },
    why: "La caserne 2 donne les éclaireurs, la muraille protège vos lanciers. Continuez à monter les ressources en parallèle : ce sont elles qui payent tout le reste.",
  },
  {
    title: '3. Économie solide',
    when: 'Les premiers jours',
    targets: { woodcutter: 8, claypit: 8, ironmine: 8, farm: 6, warehouse: 7, townhall: 5, barracks: 5, market: 1, wall: 3 },
    why: 'La caserne 5 débloque les cavaliers, les meilleurs pillards. Le marché permet de rééquilibrer vos ressources.',
  },
  {
    title: '4. Vers le premier noble',
    when: 'Ensuite',
    targets: { woodcutter: 12, claypit: 12, ironmine: 12, farm: 10, warehouse: 10, townhall: 10, barracks: 10, wall: 8 },
    why: "Hôtel de ville 10 et caserne 10 permettent de recruter le noble, qui conquiert un deuxième village. C'est le vrai cap de la croissance.",
  },
];

/** Coût total de chaque étape, en partant des niveaux atteints à l'étape précédente. */
function phasePlan() {
  let levels: Buildings = { ...STARTING_BUILDINGS };
  return PHASES.map((phase) => {
    let cost = emptyResources();
    const next = { ...levels };
    for (const k of BUILDING_KEYS) {
      const target = phase.targets[k] ?? 0;
      for (let lvl = levels[k] + 1; lvl <= target; lvl++) cost = sumRes(cost, buildingCost(k, lvl));
      next[k] = Math.max(levels[k], target);
    }
    levels = next;
    return { ...phase, cost, production: resourceProduction(levels.woodcutter), warehouse: levels.warehouse };
  });
}

export default function WikiGuide() {
  const { world } = useGame();
  const s = world.speed;
  const plan = phasePlan();
  const questReward = QUESTS.reduce((sum, q) => sumRes(sum, q.reward), emptyResources());
  const prod1 = resourceProduction(1) * s;
  const noble = UNITS.noble;
  const nobleWarehouse = warehouseFor(Math.max(...RESOURCES.map((r) => noble.cost[r])));
  const townhallMaxWarehouse = warehouseFor(Math.max(...RESOURCES.map((r) => buildingCost('townhall', BUILDINGS.townhall.maxLevel)[r])));
  // Exemple de défense : 50 lanciers derrière une muraille de niveau 5.
  const spearDefCav = Math.round((BASE_VILLAGE_DEFENSE + 50 * UNITS.spearman.defenseCavalry) * wallBonus(5));
  const spearDefInf = Math.round((BASE_VILLAGE_DEFENSE + 50 * UNITS.spearman.defenseInfantry) * wallBonus(5));
  const mixDefInf = Math.round((BASE_VILLAGE_DEFENSE + 25 * UNITS.spearman.defenseInfantry + 25 * UNITS.halberdier.defenseInfantry) * wallBonus(5));

  return (
    <>
      <Panel title="Guide du débutant">
        <p>
          Bienvenue à Aldoria ! Ce guide vous accompagne pas à pas, de votre tout premier clic jusqu'à la conquête de votre deuxième village. Pas besoin de tout retenir : suivez les étapes, et
          revenez-y quand vous vous posez une question. Ce monde tourne en <b>vitesse x{s}</b>, toutes les durées ci-dessous en tiennent compte.
        </p>
        <h3>Le jeu en une minute</h3>
        <p>
          Votre village produit quatre ressources en continu, même quand vous êtes déconnecté. Avec elles, vous améliorez vos bâtiments (qui produisent alors davantage) et vous recrutez des troupes.
          Les troupes défendent votre village, pillent les ressources des autres et, plus tard, conquièrent de nouveaux villages. Tout le jeu tient dans cette boucle :
        </p>
        <p>
          <b>produire → construire → recruter → piller ou conquérir → produire encore plus.</b>
        </p>
        <p>Pas de panique si vous débutez : un mauvais départ se rattrape toujours. Les joueurs qui progressent le plus vite sont simplement ceux qui ne laissent jamais leurs ressources dormir.</p>
      </Panel>

      <Panel title="Vos premiers pas">
        <ol>
          <li>
            <b>Regardez votre village.</b> Vous démarrez avec <Cost cost={STARTING_RESOURCES} /> et {BUILDING_KEYS.filter((k) => STARTING_BUILDINGS[k] > 0).length} bâtiments au niveau 1. Chaque bâtiment de ressource produit déjà {fmt(prod1)} par heure.
          </li>
          <li>
            <b>Suivez les quêtes</b>, sous la vue du village. Elles donnent l'ordre conseillé des premières constructions et, toutes ensemble, rapportent <Cost cost={questReward} />. Pensez à cliquer
            pour récupérer chaque récompense.
          </li>
          <li>
            <b>Gardez la file de construction pleine.</b> Elle accepte {BUILD_QUEUE_LIMIT} chantiers à la fois : lancez le suivant avant de vous déconnecter. Une file vide, c'est du temps perdu.
          </li>
          <li>
            <b>Montez d'abord les ressources</b> : {B('woodcutter')}, {B('claypit')}, {B('ironmine')} et {B('farm')}, à niveaux à peu près égaux. Puis l'{B('townhall')} au niveau 3 pour débloquer la{' '}
            {B('barracks')}.
          </li>
          <li>
            <b>Profitez de la protection débutant.</b> Pendant {hours(BEGINNER_PROTECTION_HOURS / s)}, aucun joueur ne peut vous attaquer. N'attaquez pas d'autre joueur pendant ce temps : cela
            mettrait fin à votre protection aussitôt. Les villages barbares, eux, peuvent être attaqués sans risque.
          </li>
          <li>
            <b>Rejoignez une tribu</b> dès que possible : des voisins pour vous défendre, vous conseiller et commercer.
          </li>
        </ol>
      </Panel>

      <Panel title="Ordre de construction conseillé">
        <p className="muted small">
          Un chemin éprouvé, à adapter librement. Le coût est celui de toute l'étape, en partant de l'étape précédente.
        </p>
        <div className="table-wrap">
          <table className="wiki-table">
            <thead>
              <tr>
                <th>Étape</th>
                <th>Objectifs</th>
                <th>Coût total</th>
                <th>Production ensuite</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.title}>
                  <td className="left">
                    <b>{p.title}</b>
                    <br />
                    <span className="muted small">{p.when}</span>
                  </td>
                  <td className="left small">
                    {BUILDING_KEYS.filter((k) => p.targets[k]).map((k, i) => (
                      <span key={k}>{i > 0 && ', '}{BUILDINGS[k].name} {p.targets[k]}</span>
                    ))}
                  </td>
                  <td className="left"><Cost cost={p.cost} /></td>
                  <td>{fmt(p.production * s)} / h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          {plan.map((p) => (
            <li key={p.title}><b>{p.title} :</b> {p.why}</li>
          ))}
        </ul>
      </Panel>

      <Panel title="Bien gérer ses ressources">
        <ul>
          <li>
            <b>L'entrepôt ne doit jamais déborder.</b> Une ressource pleine ne produit plus : tout ce qui dépasse est perdu. Au niveau 1, il contient {fmt(warehouseCapacity(1))} par ressource, ce
            qu'un bâtiment de niveau 1 remplit en {hours(warehouseCapacity(1) / prod1)}. Avant de vous absenter, vérifiez que l'entrepôt tiendra jusqu'à votre retour.
          </li>
          <li>
            <b>Pensez aux gros achats.</b> Un bâtiment ou une unité qui coûte plus que la capacité de l'entrepôt est impossible à payer. Il faut l'entrepôt {townhallMaxWarehouse} pour l'hôtel de
            ville {BUILDINGS.townhall.maxLevel}, et l'entrepôt {nobleWarehouse} pour un noble.
          </li>
          <li>
            <b>Le fer part vite.</b> Les soldats d'attaque en consomment beaucoup (un {U('swordsman')} : {UNITS.swordsman.cost.iron}, un {U('cavalry')} : {UNITS.cavalry.cost.iron}). Si vous prévoyez une
            armée offensive, gardez la {B('ironmine')} un peu au-dessus des autres.
          </li>
          <li>
            <b>La ferme loge l'armée.</b> Le blé est une ressource comme les autres, mais la {B('farm')} limite le nombre de soldats : {fmt(populationCapacity(1))} places au niveau 1,{' '}
            {fmt(populationCapacity(10))} au niveau 10. Un lancier prend 1 place, un cavalier {UNITS.cavalry.population}, un noble {noble.population}. Si la caserne refuse de recruter, c'est souvent la ferme. Gardez aussi du blé pour vos attaques : chacune emporte {ATTACK_WHEAT_PER_POPULATION} blé par place de population envoyée.
          </li>
          <li>
            <b>La cachette protège une réserve.</b> {fmt(HIDDEN_SHARE * 100)} % de la capacité de l'entrepôt, {fmt(HIDDEN_MAX)} au plus, est invisible pour les pillards ({fmt(hiddenResources(5))} par ressource au niveau 5). Tout le reste
            peut être volé : mieux vaut dépenser que stocker.
          </li>
          <li>
            <b>Rééquilibrez au marché.</b> Trop de bois, pas assez de fer ? Les offres du marché échangent vos surplus avec les autres joueurs et les PNJ. Chaque marchand porte {fmt(MERCHANT_CAPACITY)} ressources.
          </li>
          <li>
            <b>Le gestionnaire de compte</b> construit et recrute à votre place quand vous êtes absent, avec les mêmes règles que vous. Voir <a href="#/wiki/gestionnaire">son guide</a>.
          </li>
        </ul>
      </Panel>

      <Panel title="Vos premières troupes">
        <h3>Pour défendre</h3>
        <ul>
          <li>
            Le {U('spearman')} est le premier soldat disponible (caserne 1). Bon marché, il est redoutable contre la cavalerie ({UNITS.spearman.defenseCavalry} de défense) mais plus fragile face à
            l'infanterie ({UNITS.spearman.defenseInfantry}).
          </li>
          <li>
            Le {U('halberdier')} (caserne {UNITS.halberdier.requires.barracks}) fait l'inverse : {UNITS.halberdier.defenseInfantry} contre l'infanterie. Un mélange des deux défend bien contre
            tout le monde.
          </li>
          <li>
            La {B('wall')} ajoute +{fmt(WALL_BONUS_PER_LEVEL * 100)} % de défense par niveau à toutes les troupes du village. Exemple : 50 lanciers derrière une muraille 5 donnent {fmt(spearDefCav)} de
            défense contre la cavalerie, mais seulement {fmt(spearDefInf)} contre l'infanterie. Avec 25 lanciers et 25 hallebardiers, ce second chiffre passe à {fmt(mixDefInf)}.
          </li>
        </ul>
        <h3>Pour attaquer et piller</h3>
        <ul>
          <li>L'{U('swordsman')} (caserne {UNITS.swordsman.requires.barracks}) est l'attaquant de base : {UNITS.swordsman.attack} d'attaque pour un prix modeste.</li>
          <li>
            Le {U('cavalry')} (caserne {UNITS.cavalry.requires.barracks}) est le roi du pillage : rapide ({duration((UNITS.cavalry.speed * 60) / s)} par case) et il rapporte {UNITS.cavalry.carry} ressources,
            contre {UNITS.spearman.carry} pour un lancier.
          </li>
          <li>L'{U('scout')} (caserne {UNITS.scout.requires.barracks}) espionne avant d'attaquer. Une attaque à l'aveugle est la façon la plus rapide de perdre une armée.</li>
        </ul>
        <h3>Gagner sans perdre ses troupes</h3>
        <p>
          Le vainqueur d'un combat perd une part de ses troupes qui dépend de l'écart de force : avec une attaque deux fois plus forte que la défense, vous perdez environ {lossShare(2)} de vos soldats ;
          trois fois plus forte, {lossShare(3)} ; cinq fois plus forte, {lossShare(5)}. Le perdant, lui, perd tout. <b>Frappez donc toujours largement plus fort que nécessaire</b> : vos troupes survivent
          et rapportent plus de butin.
        </p>
      </Panel>

      <Panel title="Piller pour grandir plus vite">
        <p>Le pillage est l'accélérateur numéro un : une bonne journée de pillage peut rapporter plus que la production de vos bâtiments.</p>
        <ol>
          <li>
            <b>Visez les villages barbares.</b> Ils ne recrutent jamais et ne vous attaquent jamais. Ceux proches du centre de la carte, où vous démarrez, sont les plus faibles ; plus on s'éloigne, plus ils
            sont défendus.
          </li>
          <li>
            <b>Espionnez d'abord</b> avec quelques éclaireurs : le rapport donne leurs troupes et leurs réserves.
          </li>
          <li>
            <b>Nettoyez la garnison une fois</b> avec une attaque bien plus forte qu'elle. Une garnison vaincue ne revient pas : le village devient alors une réserve à piller sans pertes. Ses bâtiments, muraille comprise, remontent lentement : réespionnez-le de temps en temps.
          </li>
          <li>
            <b>Revenez régulièrement</b> avec de petits groupes rapides (cavaliers dès que possible). L'<a href="#/wiki/pillage">assistant de pillage</a> fait tout en un clic : il estime le butin et
            signale les attaques suicidaires.
          </li>
        </ol>
        <p className="muted small">Un butin est toujours limité à ce que vos troupes peuvent porter : 10 cavaliers rapportent au plus {fmt(10 * UNITS.cavalry.carry)} ressources.</p>
      </Panel>

      <Panel title="Ne pas se faire piller">
        <ul>
          <li>Avant la fin de la protection, ayez une muraille et quelques dizaines de défenseurs. Un village vide n'a que {BASE_VILLAGE_DEFENSE} de défense : n'importe qui le pille.</li>
          <li>Vous êtes prévenu dès le départ d'une attaque vers vous : les « Mouvements entrants » de la page Troupes et les menaces de la page Tribu montrent ce qui arrive.</li>
          <li>Un espion ennemi ne vous voit pas si vous avez autant ou plus d'éclaireurs que lui : quelques éclaireurs à la maison gardent vos secrets.</li>
          <li>Demandez des renforts à votre tribu quand une grosse attaque arrive : ils se battent avec vous et profitent de votre muraille.</li>
          <li>
            Les joueurs PNJ ne s'en prennent sans raison qu'à des joueurs de force comparable, jamais sous protection et jamais la nuit (heures calmes). Mais ils ripostent si vous les attaquez : réfléchissez
            avant de toucher à un PNJ voisin.
          </li>
        </ul>
      </Panel>

      <Panel title="Tribu, alliances et entraide">
        <ul>
          <li>Une tribu, c'est des renforts, des conseils, un marché entre amis et une alerte quand un membre est menacé. Seul, on est une cible facile.</li>
          <li>Le chef peut nouer des alliances avec d'autres tribus : leurs villages apparaissent en bleu ciel sur la carte.</li>
          <li>Coordonnez vos attaques avec les « attaques en cours » de la page Tribu, et envoyez des ressources par le marché à un membre qui en a besoin.</li>
        </ul>
        <p>Voir <a href="#/wiki/social">Rapports, messages, tribus, classement</a> pour le détail.</p>
      </Panel>

      <Panel title="Le grand cap : un deuxième village">
        <p>
          Un seul village finit par plafonner. Pour vraiment grandir, il faut en conquérir d'autres avec des {U('noble', true)}. Le noble demande {B('townhall')} {noble.requires.townhall} et{' '}
          {B('barracks')} {noble.requires.barracks}, coûte <Cost cost={noble.cost} /> et occupe {noble.population} places de ferme.
        </p>
        <ul>
          <li>
            Chaque attaque victorieuse avec un noble survivant fait baisser la loyauté du village de {NOBLE_LOYALTY_MIN} à {NOBLE_LOYALTY_MAX} points sur 100 : il faut donc{' '}
            {Math.ceil(100 / NOBLE_LOYALTY_MAX)} à {Math.ceil(100 / NOBLE_LOYALTY_MIN)} attaques avec noble.
          </li>
          <li>Le plus simple pour un premier essai : un village barbare proche et déjà vidé de sa garnison. Il ne riposte pas.</li>
          <li>Le <a href="#/wiki/conquete">train de nobles</a> du Point de ralliement envoie plusieurs nobles à une seconde d'intervalle, chacun avec son escorte.</li>
          <li>Économisez pendant que l'hôtel de ville monte : le noble coûte cher, et chaque village conquis produit à son tour.</li>
        </ul>
      </Panel>

      <Panel title="Les erreurs de débutant">
        <ul>
          <li>Laisser la file de construction vide ou l'entrepôt plein en se déconnectant.</li>
          <li>Attaquer un autre joueur pendant sa protection débutant : la vôtre s'arrête aussitôt.</li>
          <li>Recruter une grosse armée trop tôt, au lieu de monter les ressources qui la paieront.</li>
          <li>Attaquer sans espionner, ou avec une armée à peine plus forte que la défense.</li>
          <li>Stocker de grosses réserves : au-delà de la cachette, c'est un cadeau pour les pillards.</li>
          <li>Rester sans tribu.</li>
        </ul>
        <p>
          Pour aller plus loin, chaque mécanique a sa page dans le <a href="#/wiki">sommaire</a>, et les <a href="#/wiki/batiments">fiches des bâtiments</a> et{' '}
          <a href="#/wiki/troupes">des troupes</a> donnent tous les chiffres niveau par niveau. Bonne partie !
        </p>
      </Panel>
    </>
  );
}
