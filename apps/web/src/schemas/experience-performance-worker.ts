import { z } from 'zod';
import { experienceCapabilitySchema } from './experience-manifest';
import { experienceCanonicalRoutePathSchema } from './experience-route-path';

const text = z.string().max(2000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const product = z.strictObject({
  id: text,
  slug: text,
  name: text,
  price: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  image: z.strictObject({ assetId: text, alt: text }).nullable(),
  canonicalPath: text.optional(),
  available: z.boolean().optional(),
  requiresVariant: z.boolean().optional(),
  variants: z
    .array(
      z.strictObject({
        id: text,
        label: text,
        available: z.boolean(),
        price: z.number().finite().nonnegative().optional(),
      })
    )
    .max(256),
});
export const performancePublicBootstrap = z.strictObject({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  assets: z.record(z.string(), z.string().max(1000)).optional(),
  route: z.strictObject({
    epoch: z.number().int().nonnegative(),
    routeId: text,
    params: z.record(z.string(), text),
    canonicalPath: experienceCanonicalRoutePathSchema,
    publicDataRevision: text,
  }),
  catalog: z.strictObject({
    products: z.array(product).max(500),
    revision: text,
  }),
  capabilities: z.array(experienceCapabilitySchema).max(16),
});
export const performanceWorkerInput = z.strictObject({
  mode: z.literal('candidate-performance/v1'),
  width: z.union([z.literal(390), z.literal(1440)]),
  bundle: z.strictObject({
    hostOrigin: z.string().url(),
    javascript: z.string().min(1),
    css: z.string(),
    digest,
    imports: z.array(z.string()).max(4096),
  }),
  bootstrap: performancePublicBootstrap,
  html: z.string().max(2097152).optional(),
  assets: z
    .array(
      z.strictObject({
        assetId: z.string().regex(/^[a-z0-9-]{1,80}$/),
        digest,
        mime: z.enum(['image/png', 'font/woff2']),
        bytesBase64: z.string(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      })
    )
    .max(32),
});
export type PerformanceWorkerInput = z.infer<typeof performanceWorkerInput>;

const metric = z.number().finite().nonnegative().nullable();
const layoutShiftEvidence = z.strictObject({
  startTime: z.number().finite().nonnegative(),
  value: z.number().finite().nonnegative(),
  hadRecentInput: z.boolean(),
});
const metricDiagnostics = z.strictObject({
  rawCls: z.number().finite().nonnegative(),
  firstPaintMs: metric,
  rawLayoutShifts: z.array(layoutShiftEvidence).max(128),
  layoutShiftOverflow: z.boolean(),
});
export const performanceWorkerOutput = z.strictObject({
  format: z.literal('baci.performance-sample/v1'),
  policyId: z.literal('chromium-native-reference/v1'),
  browser: z.string().min(1).max(120),
  route: experienceCanonicalRoutePathSchema,
  width: z.union([z.literal(390), z.literal(1440)]),
  buildDigest: digest,
  cache: z.literal('cold-context'),
  hostLcpMs: metric,
  frameLcpMs: metric,
  hostCls: metric,
  frameCls: metric,
  diagnostics: z.strictObject({
    transport: z.enum(['http-loopback', 'https-loopback-tls']).optional(),
    tlsConnections: z.number().int().nonnegative().optional(),
    host: metricDiagnostics,
    frame: metricDiagnostics,
  }),
  interactionDurationMs: metric,
  contentVisible: z.boolean(),
  imagesDecoded: z.boolean(),
  consoleErrors: z.number().int().min(0).max(1000),
  contaminated: z.boolean(),
  observationWindowMs: z.literal(2000),
});
