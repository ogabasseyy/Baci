import 'server-only';
import { z } from 'zod';

const bindingSchema = z
  .object({ reference: z.uuid(), workflowId: z.uuid() })
  .strict();
export const oxygenActivationReferenceSchema = z.uuid();

/** Operator-provisioned individual staging trials only; production has none. */
export function readOxygenActivationBindings(): readonly z.infer<
  typeof bindingSchema
>[] {
  if (
    process.env.VERCEL_ENV === 'production' ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production')
  )
    return [];
  const raw = process.env.OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS;
  if (!raw || raw.length > 8192) return [];
  try {
    const parsed = z.array(bindingSchema).max(20).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const refs = new Set(parsed.data.map((entry) => entry.reference));
    const workflows = new Set(parsed.data.map((entry) => entry.workflowId));
    if (
      refs.size !== parsed.data.length ||
      workflows.size !== parsed.data.length
    )
      return [];
    return parsed.data;
  } catch {
    return [];
  }
}
export function oxygenActivationBinding(reference: string) {
  return readOxygenActivationBindings().find(
    (binding) => binding.reference === reference
  );
}
