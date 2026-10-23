import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { guestOAuthConsentQuotaSchema, type guestOAuthAuthorizationSchema } from '../src/schemas/guest-oauth';
import { GuestOAuthStorageError, type OAuthRecordStore } from './guest-oauth-records';

const WINDOW_MS = 5 * 60_000;
const MAX_CONSENTS = 600;
const ATTEMPTS = 4;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class GuestOAuthConsentQuotaExceeded extends Error {
  constructor(readonly retryAfterSeconds: number) { super('quota_exceeded'); }
}

export class GuestOAuthConsentBusy extends Error {
  constructor() { super('temporarily_unavailable'); }
}

/** Tenant-store CAS shares admission across replicas and source IPs. The
 * resource namespace separates deployments with distinct encryption keys. */
async function reserveConsent(store: OAuthRecordStore, scope: string, now: number) {
  const bucket = Math.floor(now / WINDOW_MS);
  const expiry = (bucket + 1) * WINDOW_MS;
  // The quota_ suffix cannot collide with hashed (hex-only) consent handles.
  const key = `consent:quota_${hash(scope).slice(0, 32)}_${bucket}`;
  const countOf = (row: Awaited<ReturnType<OAuthRecordStore['read']>>) => {
    if (!row) return 0;
    const value = guestOAuthConsentQuotaSchema.safeParse(row.value);
    if (!value.success) throw new GuestOAuthStorageError();
    return value.data.count;
  };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const row = await store.read(key);
    const count = countOf(row);
    if (count >= MAX_CONSENTS)
      throw new GuestOAuthConsentQuotaExceeded(Math.max(1, Math.ceil((expiry - now) / 1000)));
    if (await store.compareAndSwap(key, row?.revision ?? 0, { count: count + 1 }, expiry)) {
      return async () => {
        for (let refund = 0; refund < ATTEMPTS; refund++) {
          const latest = await store.read(key);
          const current = countOf(latest);
          if (!latest || current === 0) return;
          if (await store.compareAndSwap(key, latest.revision, { count: current - 1 }, expiry)) return;
        }
        // Contention keeps one slot charged until the bounded window expires.
      };
    }
  }
  throw new GuestOAuthConsentBusy();
}

/** Consent admission is separate from the cart-creation quota at approval. */
export async function createGuestConsent(
  store: OAuthRecordStore,
  request: z.infer<typeof guestOAuthAuthorizationSchema>,
  now: number,
  issuer: string,
  resource: string,
) {
  const refund = await reserveConsent(store, `${issuer}\0${resource}`, now);
  const id = randomBytes(32).toString('hex');
  const cookie = randomBytes(32).toString('hex');
  // A thrown storage error is indeterminate: retain the reservation. A false
  // CAS definitively persisted nothing and can safely refund its one slot.
  if (!(await store.compareAndSwap(`consent:${hash(id)}`, 0,
    { request, cookieHash: hash(cookie), used: false }, now + WINDOW_MS))) {
    try { await refund(); } catch { /* Keep the reservation on uncertain refunds. */ }
    throw new Error('temporarily_unavailable');
  }
  return { id, cookie };
}
