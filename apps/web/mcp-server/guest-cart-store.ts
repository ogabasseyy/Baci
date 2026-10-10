import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { guestCartLineSchema } from '../src/schemas/guest-cart-line';
import { storedCartSchema } from '../src/schemas/guest-cart-stored-cart';
import {
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';

export type GuestCartLine = z.infer<typeof guestCartLineSchema>;
/**
 * Store entry-point line: quantity 0 expresses a removal, which the
 * persisted-line schema (min 1) cannot represent. Removals are filtered
 * before parsing, so only 1-10 lines ever reach storage; typing the entry
 * point separately keeps a future parse-earlier refactor from rejecting
 * every removal.
 */
export type GuestCartLineInput = Omit<GuestCartLine, 'quantity'> & {
  quantity: number;
};

const TTL = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_LINES = 20;
// Optimistic-concurrency retries per update: a conflict means another
// writer won the version gate, so re-read, re-merge, and try again.
const MAX_ATTEMPTS = 3;

// In-process per-token mutex: concurrent updates to one cart from this
// process serialize instead of churning the version gate. Cross-process
// races resolve through the gate plus the retry loop above.
const queues = new Map<string, Promise<unknown>>();

async function runExclusive<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}

interface CartRow {
  items: GuestCartLine[];
  expires_at: number;
  version: number;
}

interface UpsertRow {
  version: number | null;
  outcome: 'ok' | 'conflict' | 'missing' | 'expired' | 'full' | string;
}

/** Opaque guest capability, never an account identity. */
export class GuestCartStore {
  /** Token-free code of the latest failed write; /health degrades until a write succeeds. */
  lastStorageErrorCode: string | null = null;

  constructor(private readonly supabase: SupabaseClient) {}

  private async rpc<T>(name: string, params: Record<string, unknown>) {
    const { data, error } = await this.supabase.rpc(name, params);
    if (error)
      throw new GuestCartStorageUnavailableError(
        `guest cart storage failed (${name})`,
        error.code ?? undefined
      );
    return data as T;
  }

  private async readCart(token: string): Promise<CartRow | null> {
    const rows = await this.rpc<
      { items: unknown; expires_at: unknown; version: unknown }[]
    >('get_mcp_guest_cart', { p_token: token });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    const version = Number(row.version);
    const parsed = storedCartSchema.safeParse({
      items: row.items,
      expires_at: new Date(row.expires_at as string | number).getTime(),
    });
    if (!Number.isInteger(version) || !parsed.success) {
      // Unusable bytes (only reachable through a direct privileged write —
      // the RPCs and CHECKs guard the shape): reclaim the row with a
      // deliberately unconditional delete (its version cannot be trusted)
      // and report it as expired so the caller recovers.
      await this.deleteBestEffort(token, null);
      return null;
    }
    return {
      items: parsed.data.items,
      expires_at: parsed.data.expires_at,
      version,
    };
  }

  private async deleteBestEffort(
    token: string,
    version: number | null
  ): Promise<void> {
    try {
      await this.rpc('delete_mcp_guest_cart', {
        p_token: token,
        p_expected_version: version,
      });
    } catch {
      /* Best effort: expiry is enforced on read regardless. */
    }
  }

  /**
   * Startup/readiness probe: one read-only RPC with a fresh random token
   * proves the worker JWT authenticates (signature, issuer, project, role,
   * grants) before the server listens. Returns null when verified, else
   * the token-free failure code. Never throws and never mutates: get is
   * read-only and the token names no row. Deliberately records nothing
   * for /health — startup either proceeds verified or exits.
   */
  async probeCapability(): Promise<string | null> {
    try {
      await this.rpc('get_mcp_guest_cart', {
        p_token: randomBytes(32).toString('hex'),
      });
      return null;
    } catch (error) {
      return error instanceof GuestCartStorageUnavailableError
        ? (error.code ?? 'unknown')
        : 'unknown';
    }
  }

  /** True when the token names a live, parseable, unexpired cart. */
  async hasToken(token: string): Promise<boolean> {
    if (!TOKEN_PATTERN.test(token)) return false;
    try {
      const cart = await this.readCart(token);
      if (!cart) return false;
      if (cart.expires_at <= Date.now()) {
        await this.deleteBestEffort(token, cart.version);
        return false;
      }
      return true;
    } catch {
      // A probe must never throw: an outage reads as "no live cart" and
      // the caller recovers without the token. Writes still record the
      // outage for /health.
      return false;
    }
  }

  async update(
    token: string | undefined,
    line: GuestCartLineInput,
    validate: (items: GuestCartLine[]) => Promise<void>
  ) {
    if (!token && line.quantity === 0)
      throw new Error('A guest cart is required');
    // UUID text is case-insensitive: canonicalize before persisting,
    // comparing, and enforcing per-product uniqueness.
    const normalizedLine = {
      ...line,
      product_id:
        typeof line.product_id === 'string'
          ? line.product_id.toLowerCase()
          : line.product_id,
    };
    if (!token) {
      // A new cart starts empty, so its merged lines are known without
      // I/O: validate before any write so a slow catalog lookup never
      // costs anything. Accepted window: the catalog may change between
      // this check and the persisted write; the website re-checks price
      // and stock at transfer, so a line that went stale is dropped there.
      await validate([guestCartLineSchema.parse(normalizedLine)]);
    }
    // Record runtime storage failures for /health (cleared by the next
    // success) so an outage cannot keep the probe green. Only the
    // token-free code is recorded, never the message.
    try {
      const result = token
        ? await this.updateTokenCart(token, normalizedLine, validate)
        : await this.createCart(normalizedLine);
      this.lastStorageErrorCode = null;
      return result;
    } catch (error) {
      if (error instanceof GuestCartStorageUnavailableError)
        this.lastStorageErrorCode = error.code ?? 'unknown';
      throw error;
    }
  }

  private async createCart(line: GuestCartLineInput) {
    const items =
      line.quantity === 0 ? [] : [guestCartLineSchema.parse(line)];
    const expiresAt = Date.now() + TTL;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const cartToken = randomBytes(32).toString('hex');
      const rows = await this.rpc<UpsertRow[]>('upsert_mcp_guest_cart', {
        p_token: cartToken,
        p_items: items,
        p_expires_at: new Date(expiresAt).toISOString(),
        p_expected_version: null,
      });
      const outcome = Array.isArray(rows) ? rows[0]?.outcome : undefined;
      if (outcome === 'ok')
        return {
          cart_token: cartToken,
          items,
          expires_at: new Date(expiresAt).toISOString(),
        };
      // The table is at capacity: a retry-later signal, never a new cart.
      // The tool layer reports storage outages as "temporarily unavailable
      // ... try again later", this transport's equivalent of a 429.
      if (outcome === 'full')
        throw new GuestCartStorageUnavailableError(
          'guest cart storage is at capacity',
          'capacity_exhausted'
        );
      // A conflict means the fresh-random token collided (live or expired
      // row): mint another. Anything else is a contract violation.
      if (outcome !== 'conflict')
        throw new GuestCartStorageUnavailableError(
          `unexpected guest cart creation outcome (${String(outcome)})`,
          'unexpected_outcome'
        );
    }
    throw new GuestCartStorageUnavailableError(
      'guest cart creation conflicted repeatedly',
      'create_conflict'
    );
  }

  private async updateTokenCart(
    token: string,
    line: GuestCartLineInput,
    validate: (items: GuestCartLine[]) => Promise<void>
  ) {
    if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid guest cart');
    return runExclusive(token, async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cart = await this.readCart(token);
        if (!cart) throw new GuestCartExpiredError();
        if (cart.expires_at <= Date.now()) {
          await this.deleteBestEffort(token, cart.version);
          throw new GuestCartExpiredError();
        }
        // Absolute quantities make a lost-response retry safe without incrementing twice.
        const items = [
          ...cart.items.filter(
            (item) => item.product_id !== line.product_id
          ),
          ...(line.quantity === 0 ? [] : [guestCartLineSchema.parse(line)]),
        ];
        if (items.length > MAX_LINES) throw new GuestCartFullError();
        await validate(items);
        if (items.length === 0) {
          // The last line was removed: delete the row instead of persisting
          // an empty cart. The token is retired: clients must drop it (its
          // next use reports expired), so say so explicitly. A version move
          // underneath means a concurrent write landed: re-read and merge
          // again instead of deleting its lines.
          const deleted = await this.rpc<boolean>('delete_mcp_guest_cart', {
            p_token: token,
            p_expected_version: cart.version,
          });
          if (deleted === true)
            return {
              cart_token: token,
              items,
              expires_at: new Date().toISOString(),
              cart_emptied: true,
            };
          continue;
        }
        // Sliding expiry: a successful write extends the cart seven days so
        // active conversations never expire mid-use; idle carts still die.
        const expiresAt = Date.now() + TTL;
        const rows = await this.rpc<UpsertRow[]>('upsert_mcp_guest_cart', {
          p_token: token,
          p_items: items,
          p_expires_at: new Date(expiresAt).toISOString(),
          p_expected_version: cart.version,
        });
        const outcome = Array.isArray(rows) ? rows[0] : undefined;
        if (outcome?.outcome === 'ok')
          return {
            cart_token: token,
            items,
            expires_at: new Date(expiresAt).toISOString(),
          };
        if (outcome?.outcome === 'conflict') continue;
        // Missing (retired or reclaimed between read and write) or expired
        // (TTL lapsed between read and write): recover, never retry.
        if (outcome?.outcome === 'missing' || outcome?.outcome === 'expired') {
          await this.deleteBestEffort(token, outcome.version ?? cart.version);
          throw new GuestCartExpiredError();
        }
        throw new GuestCartStorageUnavailableError(
          `unexpected guest cart update outcome (${String(outcome?.outcome)})`,
          'unexpected_outcome'
        );
      }
      throw new GuestCartStorageUnavailableError(
        'guest cart update conflicted repeatedly',
        'write_conflict'
      );
    });
  }
}
