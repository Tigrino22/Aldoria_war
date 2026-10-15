/** Bugs remontés par les joueurs depuis « Signaler un bug ». */
export type BugStatus = 'open' | 'fixed' | 'rejected';

export const BUG_STATUS_LABELS: Record<BugStatus, string> = { open: 'En attente', fixed: 'Corrigé', rejected: 'Non retenu' };

/** Longueur minimale et maximale de la description d'un bug. */
export const BUG_DESCRIPTION_MIN = 10;
export const BUG_DESCRIPTION_MAX = 2000;

export interface BugReportInput {
  description: string;
  /** Page du jeu où était le joueur, sans le « #/ » (« carte/12,40 »). */
  page?: string;
  device?: string;
  screen?: string;
}

/** Un bug tel que le voit son auteur (sans la note interne de l'administrateur s'il n'y en a pas). */
export interface BugReportView {
  id: number;
  description: string;
  page: string;
  status: BugStatus;
  createdAt: string;
  /** Réponse de l'administrateur, visible par le joueur. */
  adminNote: string | null;
  handledAt: string | null;
}

/** Un bug tel que le voit l'administration. */
export interface AdminBugReportView extends BugReportView {
  reporter: string;
  device: string;
  screen: string;
  handledBy: string | null;
}
