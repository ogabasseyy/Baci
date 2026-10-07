import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
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
          const entries = await readdir(this.directory);
          for (const entry of entries) {
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
