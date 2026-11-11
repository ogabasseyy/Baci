import {
  type BridgeRequest,
  EXPERIENCE_LIMITS,
  EXPERIENCE_METHOD_CAPABILITY,
} from '@baci/shared/experience';
import { z } from 'zod';
import { experienceCapabilitySchema } from './experience-manifest';

const id = z.string().min(1).max(100);
const quantity = z.number().int().min(1).max(999);
const path = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      p.startsWith('/') &&
      !p.startsWith('//') &&
      !/[\\%]/.test(p) &&
      [...p].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
  );
const args = {
  'catalog.collection': z.strictObject({
    handle: id,
    cursor: id.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  'catalog.product': z.strictObject({ handle: id }),
  'catalog.variants': z.strictObject({ productId: id }),
  'cart.reconcile': z.strictObject({ operationId: id }),
  'cart.readPublic': z.strictObject({}),
  'cart.add': z.strictObject({
    productId: id,
    variantId: id.optional(),
    condition: id.optional(),
    options: z
      .record(id, id)
      .refine((o) => Object.keys(o).length <= 10)
      .optional(),
    quantity,
  }),
  'cart.remove': z.strictObject({ lineId: id }),
  'cart.set_quantity': z.strictObject({ lineId: id, quantity }),
  'checkout.prepare': z.strictObject({}),
  'checkout.open': z.strictObject({}),
  'navigation.go': z.strictObject({ path }),
  'navigation.open': z.strictObject({ path }),
} as const;
const envelope = z.strictObject({
  protocol: z.literal('baci-commerce/1'),
  instanceId: id,
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  routeEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  requestId: id,
  capability: experienceCapabilitySchema,
  method: z.enum(
    Object.keys(args) as [keyof typeof args, ...Array<keyof typeof args>]
  ),
  args: z.record(z.string(), z.unknown()),
});
export function parseBridgeRequest(value: unknown): BridgeRequest {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length >
    EXPERIENCE_LIMITS.bridgeBytes
  )
    throw new Error('Bridge request exceeds budget');
  const parsed = envelope.parse(value);
  if (EXPERIENCE_METHOD_CAPABILITY[parsed.method] !== parsed.capability)
    throw new Error('Capability does not match method');
  return { ...parsed, args: args[parsed.method].parse(parsed.args) };
}
