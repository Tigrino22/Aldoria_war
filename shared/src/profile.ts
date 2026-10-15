/** Profil public d'un joueur. */

/** Longueur maximale de la présentation, et nombre de lignes. */
export const PROFILE_BIO_MAX = 500;
export const PROFILE_BIO_LINES = 8;
/** Conquêtes et pertes de villages montrées sur le profil. */
export const PROFILE_CONQUESTS = 10;

/** Nettoie une présentation : espaces en trop, lignes vides répétées, nombre de lignes. Renvoie une erreur lisible si elle est trop longue. */
export function cleanBio(raw: string): { bio: string } | { error: string } {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());
  const kept: string[] = [];
  for (const l of lines) if (l || (kept.length && kept[kept.length - 1])) kept.push(l);
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  if (kept.length > PROFILE_BIO_LINES) return { error: `${PROFILE_BIO_LINES} lignes au plus` };
  const bio = kept.join('\n');
  if (bio.length > PROFILE_BIO_MAX) return { error: `${PROFILE_BIO_MAX} caractères au plus` };
  return { bio };
}

/** Faits d'armes : compteurs tenus par le moteur de combat. */
export interface WarRecord {
  /** Villages pris à d'autres joueurs (les villages barbares ne comptent pas). */
  conquests: number;
  villagesLost: number;
  attackWins: number;
  defenseWins: number;
}

/** Une conquête du journal public, vue depuis le profil : gagnée (`won`) ou subie. */
export interface ProfileConquest {
  at: string;
  won: boolean;
  village: { name: string; x: number; y: number };
  /** L'autre joueur (perdant ou conquérant), tel qu'il s'appelait alors. */
  other: string;
}
