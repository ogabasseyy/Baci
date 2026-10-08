import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { guestCartLineSchema } from '../src/schemas/mcp-guest-cart';
import { acquireWriterLock } from './guest-cart-writer-lock';

const storedCartSchema = z.object({
  expires_at: z.number(),
  items: z.array(guestCartLineSchema).max(20),
});
export type GuestCartLine = z.infer<typeof guestCartLineSchema>;
export class GuestCartExpiredError extends Error {
  override readonly name = 'GuestCartExpiredError';
  constructor() {
    super('Guest cart expired or was removed');
  }
}
const queues = new Map<string, Promise<unknown>>();

/** Runs an operation exclusively per key, chaining onto any in-flight work. */
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
const TTL = 7 * 24 * 60 * 60 * 1000;
// Crash temporaries (`<cart>.json.<uuid>.tmp`) share no pattern with cart
// files and no queue key with live writers, so only sweep ones old enough
// that no in-flight write can still own them.
const STALE_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_CART_FILES = 2000;
const CRASH_TEMP_PATTERN = /^[a-f0-9]{64}\.json\..+\.tmp$/;
// The new-cart expiry sweep reads and parses every cart file, so run it at
// most once per interval; expiry is still enforced per cart on every read,
// and crash-temp cleanup below always runs.
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastExpirySweepMs = 0;
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
    try {
      const stored = storedCartSchema.parse(
        JSON.parse(await readFile(path.join(this.directory, `${token}.json`), 'utf8'))
      );
      return stored.expires_at > Date.now();
    } catch {
      return false;
    }
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
    const file = path.join(this.directory, `${cartToken}.json`);
    const queueKey = token ? file : this.directory;
    const previous = queues.get(queueKey) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        if (!token) {
          const sweepDue =
            Date.now() - lastExpirySweepMs >= SWEEP_INTERVAL_MS;
          const entries = await readdir(this.directory);
          for (const entry of entries) {
            if (CRASH_TEMP_PATTERN.test(entry)) {
              // A crash between writeFile and rename orphans the temp file
              // and the cart-file janitor below never matches it. Sweep only
              // stale files so a concurrent writer's in-flight temp survives.
              try {
                const orphan = path.join(this.directory, entry);
                const info = await stat(orphan);
                if (Date.now() - info.mtimeMs > STALE_FILE_MAX_AGE_MS)
                  await unlink(orphan);
              } catch {
                /* Best effort: janitor work never fails cart creation. */
              }
              continue;
            }
            if (!sweepDue) continue;
            if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
            const candidate = path.join(this.directory, entry);
            if (queues.has(candidate)) continue;
            try {
              const existing = storedCartSchema.parse(
                JSON.parse(await readFile(candidate, 'utf8'))
              );
              if (existing.expires_at <= Date.now()) await unlink(candidate);
            } catch {
              // Reads parse cart files too, so a corrupt file is already
              // unusable dead weight that would pin capacity forever. Reclaim
              // it once old enough that no external writer can still be
              // producing it; fresh files are left for a later sweep.
              try {
                const info = await stat(candidate);
                if (Date.now() - info.mtimeMs > STALE_FILE_MAX_AGE_MS)
                  await unlink(candidate);
              } catch {
                /* Best effort: janitor work never fails cart creation. */
              }
            }
          }
          if (sweepDue) lastExpirySweepMs = Date.now();
          let cartFiles = (await readdir(this.directory)).filter((entry) =>
            /^[a-f0-9]{64}\.json$/.test(entry)
          );
          if (cartFiles.length >= MAX_CART_FILES) {
            // The throttled sweep above may have been skipped, and expired
            // carts must never force eviction of live ones: reclaim them now
            // and recount before falling back to LRU eviction.
            for (const entry of cartFiles) {
              const candidate = path.join(this.directory, entry);
              if (queues.has(candidate)) continue;
              try {
                const existing = storedCartSchema.parse(
                  JSON.parse(await readFile(candidate, 'utf8'))
                );
                if (existing.expires_at <= Date.now()) await unlink(candidate);
              } catch {
                /* Corrupt files stay for the guarded janitor. */
              }
            }
            cartFiles = (await readdir(this.directory)).filter((entry) =>
              /^[a-f0-9]{64}\.json$/.test(entry)
            );
          }
          if (cartFiles.length >= MAX_CART_FILES) {
            // One guest must not permanently exhaust the shared pool: evict
            // the least-recently-written cart instead of failing. Idle carts
            // may be dropped under sustained pressure; active carts survive
            // because every write refreshes mtime.
            const withMtime = (
              await Promise.all(
                cartFiles.map(async (entry) => {
                  try {
                    const info = await stat(path.join(this.directory, entry));
                    return { entry, mtimeMs: info.mtimeMs };
                  } catch {
                    return null;
                  }
                })
              )
            ).filter(
              (found): found is { entry: string; mtimeMs: number } =>
                found !== null
            );
            withMtime.sort((a, b) => a.mtimeMs - b.mtimeMs);
            let evicted = false;
            for (const { entry, mtimeMs } of withMtime) {
              const candidate = path.join(this.directory, entry);
              // Join the cart's own queue so eviction runs strictly before
              // or after any in-flight update instead of racing it, then
              // re-check mtime: a preceding update refreshes it, so a newer
              // file is skipped in favor of the next oldest.
              const done = await runExclusive(candidate, async () => {
                try {
                  const info = await stat(candidate);
                  if (info.mtimeMs > mtimeMs) return false;
                  await unlink(candidate);
                  return true;
                } catch {
                  return false;
                }
              });
              if (done) {
                evicted = true;
                break;
              }
            }
            if (!evicted) throw new Error('Guest cart capacity reached');
          }
        }
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
          ...stored.items.filter((item) => item.product_id !== line.product_id),
          ...(line.quantity === 0 ? [] : [guestCartLineSchema.parse(line)]),
        ];
        if (items.length > 20) throw new Error('Guest cart is full');
        await validate(items);
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
    queues.set(queueKey, operation);
    try {
      return await operation;
    } finally {
      if (queues.get(queueKey) === operation) queues.delete(queueKey);
    }
  }
}
