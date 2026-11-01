import { z } from 'zod';

const localPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..')
  );
const assetUrl = z.string().startsWith('/_next/');

export const layoutCaptureManifestSchema = z.object({
  version: z.literal(1),
  assets: z.array(z.object({ path: localPath, url: assetUrl })),
  captures: z.array(
    z.object({
      dependencyFiles: z.array(assetUrl),
      htmlPath: localPath,
      identifier: z.string().min(1),
      url: z.url(),
      kind: z.enum(['home', 'category', 'pdp', 'blog', 'generic']),
    })
  ),
});

export const prerenderManifestSchema = z.object({
  routes: z.record(z.string(), z.unknown()),
});

export type LayoutCaptureManifest = z.infer<typeof layoutCaptureManifestSchema>;
