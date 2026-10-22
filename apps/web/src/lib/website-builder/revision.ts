import { z } from 'zod';

const revisionSchema = z
  .string()
  .regex(
    /^draft:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
export function parseDraftRevision(value: unknown): string {
  return revisionSchema.parse(value);
}
