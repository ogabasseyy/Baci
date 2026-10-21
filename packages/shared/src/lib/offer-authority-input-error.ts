/** Thrown when the caller passes malformed ids; adapters fail closed. */
export class OfferAuthorityInputError extends Error {
  readonly ids: string[];

  constructor(ids: string[]) {
    super(`Invalid offer authority ids: ${ids.join(', ')}`);
    this.name = 'OfferAuthorityInputError';
    this.ids = ids;
  }
}
