import { z } from 'zod';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  buildDigest: digest,
  canonicalBase: z.string(),
  scriptDigest: digest,
  styleDigest: digest,
  assets: z.record(z.string().regex(/^[a-z0-9-]{1,80}$/), digest),
});

/** Derive every permitted output URL from the bound public head. */
export function describePublicOutput(input: unknown, executionOrigin: string) {
  const binding = bindingSchema.parse(input);
  const origin = productionDeliveryOrigins({
    executionOrigin,
    hostOrigins: [binding.canonicalBase],
  }).executionOrigin;
  const base = `${origin}/published/${binding.slug}/${binding.buildDigest}`;
  const required = [
    {
      path: 'app.js',
      digest: binding.scriptDigest,
      mimes: ['text/javascript'],
    },
    { path: 'app.css', digest: binding.styleDigest, mimes: ['text/css'] },
    ...Object.entries(binding.assets).map(([id, value]) => ({
      path: `assets/${id}`,
      digest: value,
      mimes: ['image/png', 'font/woff2'],
    })),
  ];
  return required.map((item) => ({ ...item, url: `${base}/${item.path}` }));
}

/** Read and validate delivered output only; no public mutation or browser code. */
export async function checkPublicOutput(
  input: unknown,
  executionOrigin: string,
  fetchBound: (url: string) => Promise<{
    body: Buffer;
    contentType: string;
    securityHeaders?: Record<string, string>;
  }>
) {
  const required = describePublicOutput(input, executionOrigin);
  const files = [];
  for (const expected of required) {
    const url = expected.url;
    const response = await fetchBound(url);
    const mime = response.contentType.split(';', 1)[0].trim().toLowerCase();
    if (
      !expected.mimes.includes(mime) ||
      digestBytes(response.body) !== expected.digest
    )
      throw Error('PUBLIC_OUTPUT_MISMATCH');
    files.push({
      url,
      mime,
      bytes: response.body,
      securityHeaders: response.securityHeaders ?? {},
    });
  }
  return files;
}
