import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  guestCartLineSchema,
  storedCartSchema,
} from '../src/schemas/mcp-guest-cart';
import {
  admitGuestCartWrite,
  runExclusive,
} from './guest-cart-admission';
import { acquireWriterLock } from './guest-cart-writer-lock';

export type GuestCartLine = z.infer<typeof guestCartLineSchema>;
export class GuestCartExpiredError extends Error {
  override readonly name = 'GuestCartExpiredError';
  constructor() {
    super('Guest cart expired or was removed');
  }
}
const TTL = 7 * 24 * 60 * 60 * 1000;
async function readStoredCart(file: string) {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    // A swept, evicted, or never-minted token is recoverable: the caller
    // retries without the token. Other I/O failures stay generic.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
      throw new GuestCartExpiredError();
    throw error;
  }
  try {
    return storedCartSchema.parse(JSON.parse(raw));
  } catch {
    // Bytes were read but are unusable, and atomic renames mean a corrupt
    // cart file can never become valid on its own: report it as expired so
    // the caller recovers, and reclaim the capacity slot it would pin.
    await unlink(file).catch(() => undefined);
    throw new GuestCartExpiredError();
  }
}

/** Opaque guest capability, never an account identity. One writer process owns this directory. */
export class GuestCartStore {
  constructor(private readonly directory: string) {
    acquireWriterLock(directory);
  }

  /** True when the token names a live, parseable, unexpired cart. */
  async hasToken(token: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    // Join the cart's queue so the probe cannot race a concurrent update
    // or eviction of the same file.
    const file = path.join(this.directory, `${token}.json`);
    return runExclusive(file, async () => {
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        return false;
      }
      try {
        return storedCartSchema.parse(JSON.parse(raw)).expires_at > Date.now();
      } catch {
        // Unusable bytes would pin a capacity slot until the hourly
        // janitor; reclaim them like a read does.
        await unlink(file).catch(() => undefined);
        return false;
      }
    });
  }

  async update(
    token: string | undefined,
    line: GuestCartLine,
    validate: (items: GuestCartLine[]) => Promise<void>
  ) {
    if (!token && line.quantity === 0)
      throw new Error('A guest cart is required');
    const cartToken = token ?? randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(cartToken))
      throw new Error('Invalid guest cart');
    // UUID text is case-insensitive: canonicalize before persisting,
    // comparing, and enforcing per-product uniqueness.
    const normalizedLine = {
      ...line,
      product_id:
        typeof line.product_id === 'string'
          ? line.product_id.toLowerCase()
          : line.product_id,
    };
    const file = path.join(this.directory, `${cartToken}.json`);
    const queueKey = token ? file : this.directory;
    if (!token) {
      // A new cart starts empty, so its merged lines are known without
      // I/O: validate before queueing so a slow catalog lookup never
      // stalls other creators behind the shared directory lock. Rejected
      // lines still never reach eviction, which stays inside the queue.
      // Accepted window: the catalog may change between this check and
      // the persisted write; the website re-checks price and stock at
      // transfer, so a line that went stale is dropped there.
      await validate([guestCartLineSchema.parse(normalizedLine)]);
    }
    return runExclusive(queueKey, async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        let stored: z.infer<typeof storedCartSchema>;
        if (!token) {
          stored = { expires_at: Date.now() + TTL, items: [] };
        } else {
          stored = await readStoredCart(file);
          if (stored.expires_at <= Date.now()) {
            await unlink(file).catch(() => undefined);
            throw new GuestCartExpiredError();
          }
        }
        // Absolute quantities make a lost-response retry safe without incrementing twice.
        const items = [
          ...stored.items.filter(
            (item) => item.product_id !== normalizedLine.product_id
          ),
          ...(normalizedLine.quantity === 0
            ? []
            : [guestCartLineSchema.parse(normalizedLine)]),
        ];
        if (items.length > 20) throw new Error('Guest cart is full');
        // Token-bound updates merge with the stored cart under its own
        // per-file queue, so they validate here; creations validated
        // above, before queueing. Either way a rejected line never
        // reaches eviction to cost another shopper's live cart.
        if (token) await validate(items);
        await admitGuestCartWrite(this.directory, !token);
        if (token && items.length === 0) {
          // The last line was removed: delete the file instead of persisting
          // an empty cart, so emptied carts stop pinning capacity slots. The
          // token dangles; its next use reports expired and recovers.
          await unlink(file).catch(() => undefined);
          return {
            cart_token: token,
            items,
            expires_at: new Date().toISOString(),
          };
        }
        // Sliding expiry: a successful write extends the cart seven days so
        // active conversations never expire mid-use; idle carts still die.
        stored = { ...stored, expires_at: Date.now() + TTL };
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ ...stored, items }), {
            mode: 0o600,
          });
          await rename(temporary, file);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        return {
          cart_token: cartToken,
          items,
          expires_at: new Date(stored.expires_at).toISOString(),
        };
      });
  }
}
