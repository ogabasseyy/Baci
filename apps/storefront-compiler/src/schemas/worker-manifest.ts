import { z } from 'zod';

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

export const WORKER_COMPILER_LIMITS = {
  maxFiles: 64,
  maxFileBytes: 512 * 1024,
  maxTotalSourceBytes: 1024 * 1024,
  maxRoutes: 64,
  maxAssets: 128,
  maxCspOriginsPerDirective: 16,
  maxWorkerGzipBytes: 1024 * 1024,
  maxClientGzipBytes: 150 * 1024,
  maxCssRawBytes: 256 * 1024,
  maxCssGzipBytes: 50 * 1024,
} as const;

export const ALLOWED_STOREFRONT_PACKAGES = [
  'react',
  'react-dom',
  '@baci/experience-sdk',
  '@baci/shared',
  'framer-motion',
] as const;

export type AllowedStorefrontPackage =
  (typeof ALLOWED_STOREFRONT_PACKAGES)[number];

export const PLATFORM_VETTED_CSP_HOSTS: ReadonlySet<string> = new Set([
  'connect.facebook.net',
  'www.facebook.com',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'analytics.tiktok.com',
  'cdn.usebaci.com',
  'images.unsplash.com',
]);

const IPV4_OR_IPV6_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])$/;

export const httpsOriginSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((raw) => {
    if (raw.includes('*')) return false;
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === 'https:' &&
        parsed.origin === raw &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.pathname === '/' &&
        parsed.search === '' &&
        parsed.hash === '' &&
        parsed.hostname.includes('.') &&
        !IPV4_OR_IPV6_HOST.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, 'CSP allowlist entry must be a bare HTTPS hostname origin without wildcards or raw IPs');

export const relativeSourcePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (filePath) =>
      !filePath.startsWith('/') &&
      !filePath.startsWith('__baci_') &&
      !/[\\%:\0]/.test(filePath) &&
      filePath
        .split('/')
        .every(
          (segment) =>
            segment !== '' &&
            segment !== '.' &&
            segment !== '..' &&
            !segment.startsWith('__baci_')
        ) &&
      /^[a-zA-Z0-9_./-]+$/.test(filePath) &&
      /\.(?:tsx|ts|jsx|js|css)$/.test(filePath),
    'Unsafe or unsupported storefront source path'
  );

export const storefrontRouteViewSchema = z.enum([
  'home',
  'collection',
  'product',
  'search',
  'cart',
  'editorial',
]);

export type StorefrontRouteView = z.infer<typeof storefrontRouteViewSchema>;

export const cspAllowlistSchema = z
  .strictObject({
    scriptOrigins: z
      .array(httpsOriginSchema)
      .max(WORKER_COMPILER_LIMITS.maxCspOriginsPerDirective)
      .default([]),
    connectOrigins: z
      .array(httpsOriginSchema)
      .max(WORKER_COMPILER_LIMITS.maxCspOriginsPerDirective)
      .default([]),
    imgOrigins: z
      .array(httpsOriginSchema)
      .max(WORKER_COMPILER_LIMITS.maxCspOriginsPerDirective)
      .default([]),
  })
  .default({
    scriptOrigins: [],
    connectOrigins: [],
    imgOrigins: [],
  });

export type CspAllowlist = z.infer<typeof cspAllowlistSchema>;

export const workerStorefrontManifestSchema = z
  .strictObject({
    format: z.literal('baci.storefront-worker/v1'),
    mode: z.enum(['composable', 'full-code']),
    entry: relativeSourcePathSchema,
    files: z
      .array(
        z.strictObject({
          path: relativeSourcePathSchema,
          content: z
            .string()
            .refine(
              (content) =>
                utf8ByteLength(content) <= WORKER_COMPILER_LIMITS.maxFileBytes,
              'Source file exceeds 512 KiB per-file budget'
            ),
        })
      )
      .min(1)
      .max(WORKER_COMPILER_LIMITS.maxFiles),
    packages: z
      .array(
        z.strictObject({
          name: z.enum(ALLOWED_STOREFRONT_PACKAGES),
          versionRef: z.literal('platform-pinned'),
        })
      )
      .max(ALLOWED_STOREFRONT_PACKAGES.length)
      .default([]),
    routes: z
      .array(
        z.strictObject({
          path: z
            .string()
            .min(1)
            .max(240)
            .regex(/^\/(?:[a-zA-Z0-9_:\-[\]/]*)$/),
          view: storefrontRouteViewSchema,
        })
      )
      .min(1)
      .max(WORKER_COMPILER_LIMITS.maxRoutes),
    assets: z
      .array(
        z.strictObject({
          assetId: z.string().regex(/^[a-z0-9-]{1,80}$/),
          alt: z.string().min(1).max(500),
        })
      )
      .max(WORKER_COMPILER_LIMITS.maxAssets)
      .default([]),
    themeTokens: z
      .strictObject({
        primary: z.string().min(1).max(64),
        secondary: z.string().min(1).max(64),
        accent: z.string().min(1).max(64),
      })
      .default({
        primary: 'hsl(222 47% 11%)',
        secondary: 'hsl(210 40% 96%)',
        accent: 'hsl(0 84% 60%)',
      }),
    cspAllowlist: cspAllowlistSchema,
  })
  .superRefine((manifest, ctx) => {
    const normalizedPaths = manifest.files.map((file) =>
      file.path.toLowerCase()
    );
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Case-insensitive source path collision detected',
      });
    }
    if (!manifest.files.some((file) => file.path === manifest.entry)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Manifest entry file is missing from files[]',
      });
    }
    const totalBytes = manifest.files.reduce(
      (sum, file) => sum + utf8ByteLength(file.content),
      0
    );
    if (totalBytes > WORKER_COMPILER_LIMITS.maxTotalSourceBytes) {
      ctx.addIssue({
        code: 'custom',
        message: 'Total source payload exceeds 1 MiB Worker profile budget',
      });
    }
    const routePaths = manifest.routes.map((route) => route.path);
    if (new Set(routePaths).size !== routePaths.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate route path in manifest',
      });
    }
  });

export type WorkerStorefrontManifest = z.infer<
  typeof workerStorefrontManifestSchema
>;

export interface CspGovernanceSummary {
  allowlist: CspAllowlist;
  vettedOrigins: string[];
  unvettedOrigins: string[];
}

export function summarizeCspGovernance(
  allowlist: CspAllowlist
): CspGovernanceSummary {
  const uniqueOrigins = Array.from(
    new Set([
      ...allowlist.scriptOrigins,
      ...allowlist.connectOrigins,
      ...allowlist.imgOrigins,
    ])
  ).sort();
  const vettedOrigins: string[] = [];
  const unvettedOrigins: string[] = [];
  for (const origin of uniqueOrigins) {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (PLATFORM_VETTED_CSP_HOSTS.has(hostname)) {
      vettedOrigins.push(origin);
    } else {
      unvettedOrigins.push(origin);
    }
  }
  return { allowlist, vettedOrigins, unvettedOrigins };
}

export function parseWorkerStorefrontManifest(
  input: unknown
): WorkerStorefrontManifest {
  return workerStorefrontManifestSchema.parse(input);
}
