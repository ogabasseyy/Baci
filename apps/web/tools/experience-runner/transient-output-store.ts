import { randomUUID } from 'node:crypto';
/** Trusted job-output-only staging. Sweep never touches owner/durable build storage. */
export function createTransientOutputStore() {
  const values = new Map<string, { expiresAt: number; value: unknown }>();
  return {
    put(value: unknown, now: number) {
      const id = randomUUID();
      values.set(id, {
        expiresAt: now + 86400000,
        value: structuredClone(value),
      });
      return id;
    },
    read(id: string, now: number): unknown {
      const r = values.get(id);
      if (!r || r.expiresAt <= now) throw Error('NOT_FOUND');
      return structuredClone(r.value);
    },
    remove(id: string) {
      values.delete(id);
    },
    sweep(now: number) {
      for (const [id, r] of values) if (r.expiresAt <= now) values.delete(id);
    },
  };
}
export type TransientOutputStore = ReturnType<
  typeof createTransientOutputStore
>;
