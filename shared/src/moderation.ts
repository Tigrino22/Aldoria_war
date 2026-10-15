/** Signalements : ce qu'un joueur peut signaler à l'administration, et pourquoi. */
export const MODERATION_KINDS = ['player', 'message', 'tribe'] as const;
export type ModerationKind = (typeof MODERATION_KINDS)[number];

export const MODERATION_REASONS = ['insult', 'cheat', 'name', 'spam', 'other'] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

export const MODERATION_REASON_LABELS: Record<ModerationReason, string> = {
  insult: 'Insultes ou harcèlement',
  cheat: 'Triche ou multicompte',
  name: 'Nom ou description inappropriés',
  spam: 'Spam ou publicité',
  other: 'Autre',
};

export const MODERATION_KIND_LABELS: Record<ModerationKind, string> = {
  player: 'Joueur',
  message: 'Message',
  tribe: 'Tribu',
};

export type ModerationStatus = 'open' | 'done' | 'rejected';

/** Longueur maximale du commentaire d'un signalement et de la note de l'administrateur. */
export const MODERATION_COMMENT_MAX = 1000;

export interface ModerationReportInput {
  kind: ModerationKind;
  /** Pseudo du joueur (kind = 'player'), id du message reçu (kind = 'message') ou id de la tribu (kind = 'tribe'). */
  target: string | number;
  reason: ModerationReason;
  comment?: string;
}

/** Un signalement tel que le voit l'administration. */
export interface ModerationReportView {
  id: number;
  kind: ModerationKind;
  reason: ModerationReason;
  comment: string;
  status: ModerationStatus;
  createdAt: string;
  reporter: string;
  /** Joueur visé (auteur du message pour un message), avec son id pour ouvrir sa fiche ; null pour une tribu. */
  targetPlayer: { id: number | null; name: string } | null;
  targetTribe: { id: number | null; name: string } | null;
  /** Copie du message au moment du signalement. */
  message: { subject: string; body: string } | null;
  /** Signalements déjà reçus contre la même cible (tous statuts confondus), celui-ci compris. */
  sameTarget: number;
  adminNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
}
