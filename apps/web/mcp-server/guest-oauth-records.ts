/** Durable encrypted records, scoped by the store's trusted merchant identity. */
export interface OAuthRecordStore {
  read(key: string): Promise<{ value: unknown; revision: number; expiresAt: number } | null>;
  compareAndSwap(
    key: string,
    revision: number,
    value: unknown,
    expiresAt: number,
  ): Promise<boolean>;
}

export class GuestOAuthStorageError extends Error {
  constructor() {
    super('OAuth storage unavailable');
    this.name = 'GuestOAuthStorageError';
  }
}
