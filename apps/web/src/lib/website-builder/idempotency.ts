import { z } from 'zod';
/** Canonical input hashing and retained replay evidence live in the atomic SQL transaction. */
export function parseDraftRetryKey(value: unknown): string {
  return z.uuid().parse(value);
}
