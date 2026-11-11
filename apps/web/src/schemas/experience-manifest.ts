import {
  EXPERIENCE_LIMITS,
  type ExperienceManifest,
} from '@baci/shared/experience';
import { z } from 'zod';

const utf8 = (value: string) => new TextEncoder().encode(value).length;
const pathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !/[\\%:]/.test(p) &&
      p
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..') &&
      /^[a-zA-Z0-9_./-]+$/.test(p),
    'Unsafe source path'
  );
export const experienceCapabilitySchema = z.enum([
  'catalog.read',
  'cart.read-public',
  'cart.mutate',
  'checkout.prepare',
  'checkout.open',
  'navigation',
]);
export const experienceManifestSchema = z
  .strictObject({
    format: z.literal('baci.experience/v2'),
    runtime: z.literal('react-browser-sandbox/v1'),
    sdkVersion: z.literal('commerce-bridge/v1'),
    entry: pathSchema,
    files: z
      .array(
        z.strictObject({
          path: pathSchema,
          content: z
            .string()
            .refine(
              (s) => utf8(s) <= EXPERIENCE_LIMITS.fileBytes,
              'Source file exceeds budget'
            ),
        })
      )
      .min(1)
      .max(EXPERIENCE_LIMITS.files),
    packages: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(100),
          versionRef: z.literal('platform-pinned'),
        })
      )
      .max(32),
    routes: z
      .array(
        z.strictObject({
          path: z
            .string()
            .min(1)
            .max(240)
            .regex(/^\/(?:[a-zA-Z0-9_\-[\]/]*)$/),
          view: z.enum(['home', 'collection', 'product', 'editorial']),
        })
      )
      .min(1)
      .max(128),
    assets: z
      .array(
        z.strictObject({
          assetId: z.string().regex(/^[a-z0-9-]{1,80}$/),
          alt: z.string().max(500),
        })
      )
      .max(128),
    capabilities: z.array(experienceCapabilitySchema).max(16),
  })
  .superRefine((m, ctx) => {
    const paths = m.files.map((f) => f.path.toLowerCase());
    if (new Set(paths).size !== paths.length)
      ctx.addIssue({ code: 'custom', message: 'Source path collision' });
    if (!m.files.some((f) => f.path === m.entry))
      ctx.addIssue({ code: 'custom', message: 'Entry missing' });
    if (
      m.files.reduce((sum, f) => sum + utf8(f.content), 0) >
      EXPERIENCE_LIMITS.sourceBytes
    )
      ctx.addIssue({ code: 'custom', message: 'Source exceeds total budget' });
    if (new Set(m.routes.map((r) => r.path)).size !== m.routes.length)
      ctx.addIssue({ code: 'custom', message: 'Route collision' });
  });
export function parseExperienceManifest(value: unknown): ExperienceManifest {
  return experienceManifestSchema.parse(value);
}
