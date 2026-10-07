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

const storedCartSchema = z.object({
  expires_at: z.number(),
  items: z.array(guestCartLineSchema).max(20),
});
export type GuestCartLine = z.infer<typeof guestCartLineSchema>;
const queues = new Map<string, Promise<unknown>>();
const TTL = 7 * 24 * 60 * 60 * 1000;
// Crash temporaries (`<cart>.json.<uuid>.tmp`) share no pattern with cart
// files and no queue key with live writers, so only sweep ones old enough
// that no in-flight write can still own them.
const STALE_TEMP_MAX_AGE_MS = 60 * 60 * 1000;
const CRASH_TEMP_PATTERN = /^[a-f0-9]{64}\.json\..+\.tmp$/;
// The new-cart expiry sweep reads and parses every cart file, so run it at
// most once per interval; expiry is still enforced per cart on every read,
// and crash-temp cleanup below always runs.
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastExpirySweepMs = 0;

/** Opaque guest capability, never an account identity. One writer process owns this directory. */
export class GuestCartStore {
  constructor(private readonly directory: string) {}

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
                if (Date.now() - info.mtimeMs > STALE_TEMP_MAX_AGE_MS)
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
              /* Do not delete corrupt or externally owned files. */
            }
          }
          if (sweepDue) lastExpirySweepMs = Date.now();
          if (
            (await readdir(this.directory)).filter((entry) =>
              /^[a-f0-9]{64}\.json$/.test(entry)
            ).length >= 2000
          )
            throw new Error('Guest cart capacity reached');
        }
        const stored = token
          ? storedCartSchema.parse(JSON.parse(await readFile(file, 'utf8')))
          : { expires_at: Date.now() + TTL, items: [] };
        if (stored.expires_at <= Date.now())
          throw new Error('Guest cart expired');
        // Absolute quantities make a lost-response retry safe without incrementing twice.
        const items = [
          ...stored.items.filter((item) => item.product_id !== line.product_id),
          ...(line.quantity === 0 ? [] : [guestCartLineSchema.parse(line)]),
        ];
        if (items.length > 20) throw new Error('Guest cart is full');
        await validate(items);
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
