import z from 'zod';

// A Supabase project ref: the suffix Supavisor's session pooler needs on the
// database user (`<login>.<ref>`). See lib/piggyvest/primary-db-link.ts.
export const PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

// PiggyVest server entries composed into env.ts. Both are optional and never
// fail boot: PiggyVest ships dark, and a malformed pooler ref fails closed
// only in the PiggyVest database executors.
export const piggyvestServerEnvShape = {
  PIGGYVEST_SECRET_KEY: z.string().optional(),
  PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF: z.string().optional(),
};

export function readPiggyvestServerEnv(
  source: Record<string, string | undefined> = process.env
): Record<keyof typeof piggyvestServerEnvShape, string | undefined> {
  return {
    PIGGYVEST_SECRET_KEY: source.PIGGYVEST_SECRET_KEY,
    PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF:
      source.PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF,
  };
}
