import { z } from 'zod';
import { PILOT_SHA256_PATTERN } from './merchant-image-variant-pilot-constants';

// Lab-only inventory binding: the frozen merchant/asset/URL/source tuple.
// Re-exported from merchant-image-variant-pilot.ts; import from there.
export const pilotInventoryBindingSchema = z
  .object({
    assetId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    merchantId: z.uuid(),
    originalUrl: z.url({ protocol: /^https?$/ }),
    role: z.enum(['logo', 'product', 'hero']),
    slotId: z.string().min(1).max(128),
    sourceSha256: z.string().regex(PILOT_SHA256_PATTERN),
  })
  .strict();

export type PilotInventoryBinding = z.infer<typeof pilotInventoryBindingSchema>;

export function parsePilotInventoryBinding(
  value: unknown
):
  | { ok: true; binding: PilotInventoryBinding }
  | { ok: false; issues: string[] } {
  const parsed = pilotInventoryBindingSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { binding: parsed.data, ok: true };
}
