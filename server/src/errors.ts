export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Introuvable') => new GameError(what, 404);
export const forbidden = (what = 'Action interdite') => new GameError(what, 403);
