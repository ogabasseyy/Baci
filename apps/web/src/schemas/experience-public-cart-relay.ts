import { z } from 'zod';

export const publicCartRelayBuildDigest = z.string().regex(/^[a-f0-9]{64}$/);

export function createPublicCartRelaySchemas(settings: {
  merchantSlug: string;
  productId: string;
  variantId?: string;
}) {
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(settings.merchantSlug);
  const productId = z.uuid().parse(settings.productId);
  const variantId =
    settings.variantId === undefined
      ? undefined
      : z.uuid().parse(settings.variantId);
  const identity = z.strictObject({
    productId: z.literal(productId),
    ...(variantId ? { variantId: z.literal(variantId) } : {}),
  });
  const line = z.strictObject({ item: identity, quantity: z.literal(1) });
  const operationId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/);
  const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
  const create = z.strictObject({
    operationId,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    lines: z.array(line).max(1).optional(),
  });
  const command = z.strictObject({
    operationId,
    expectedVersion: version,
    command: z.strictObject({
      type: z.literal('add'),
      item: identity,
      quantity: z.literal(1),
    }),
  });
  const review = z.strictObject({
    operationId,
    expectedVersion: version,
    cartId: z.uuid(),
  });
  const bootstrap = z.strictObject({
    merchantSlug: z.literal(slug).optional(),
  });
  return {
    slug,
    create,
    command,
    review,
    bootstrap,
    launch: (buildDigest: string, path: string) =>
      z.strictObject({
        buildDigest: z.literal(buildDigest),
        path: z.literal(path),
      }),
  };
}
