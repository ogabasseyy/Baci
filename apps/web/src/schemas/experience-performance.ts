import { z } from 'zod';
import { experienceCanonicalRoutePathSchema } from './experience-route-path';
import { experienceDigest } from './experience-upload';

const layoutShiftEvidence = z.strictObject({
  startTime: z.number().finite().nonnegative(),
  value: z.number().finite().nonnegative(),
  hadRecentInput: z.boolean(),
});
const metricDiagnostics = z.strictObject({
  rawCls: z.number().finite().nonnegative(),
  firstPaintMs: z.number().finite().nonnegative().nullable(),
  rawLayoutShifts: z.array(layoutShiftEvidence).max(128),
  layoutShiftOverflow: z.boolean(),
});

/** Lab diagnostics never confer publication or field-CWV authority. */
export const experiencePerformanceReport = z.strictObject({
  format: z.literal('baci.performance-lab/v1'),
  buildDigest: experienceDigest,
  sourceDigest: experienceDigest,
  measuredAt: z.iso.datetime(),
  renderer: z.enum(['client', 'prerender']),
  environment: z.literal('local-synthetic'),
  cwvQualified: z.literal(false),
  releaseQualified: z.literal(false),
  contaminated: z.boolean(),
  browser: z.string().min(1).max(120),
  bootstrapDigests: z
    .array(
      z.strictObject({
        route: experienceCanonicalRoutePathSchema,
        digest: experienceDigest,
      })
    )
    .min(1)
    .max(4)
    .optional(),
  samples: z
    .array(
      z.strictObject({
        width: z.union([z.literal(390), z.literal(1440)]),
        cache: z.literal('cold-context'),
        route: experienceCanonicalRoutePathSchema,
        frameLcpMs: z.number().finite().nonnegative().nullable(),
        hostLcpMs: z.number().finite().nonnegative().nullable(),
        frameCls: z.number().finite().nonnegative().nullable(),
        hostCls: z.number().finite().nonnegative().nullable(),
        diagnostics: z
          .strictObject({
            host: metricDiagnostics,
            frame: metricDiagnostics,
            transport: z
              .enum(['http-loopback', 'https-loopback-tls'])
              .optional(),
            tlsConnections: z.number().int().nonnegative().optional(),
          })
          .optional(),
        interactionDurationMs: z.number().finite().nonnegative().nullable(),
        contentVisible: z.boolean(),
        imagesDecoded: z.boolean(),
        consoleErrors: z.number().int().nonnegative(),
      })
    )
    .min(1)
    .max(96),
});
export type ExperiencePerformanceReport = z.infer<
  typeof experiencePerformanceReport
>;
