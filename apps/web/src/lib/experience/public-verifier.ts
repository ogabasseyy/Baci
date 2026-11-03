import { z } from 'zod';
import { digestBytes } from './manifest-digest';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const observation = z.strictObject({
  parentBuild: digest,
  frameBuild: digest,
  scriptDigest: digest,
  styleDigest: digest,
  routes: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(240),
        title: z.string().min(1).max(500),
        canonical: z.url(),
        status: z.literal(200),
      })
    )
    .min(1)
    .max(128),
  journey: z.strictObject({
    steps: z
      .array(
        z.strictObject({
          action: z.enum([
            'navigate',
            'product',
            'cart-add',
            'cart-read',
            'checkout-review',
          ]),
          path: z.string().min(1).max(240),
          evidenceDigest: digest,
        })
      )
      .min(1)
      .max(32),
    orderRequests: z.literal(0),
    paymentRequests: z.literal(0),
  }),
  assets: z.record(z.string(), digest),
  evidenceDigest: digest,
});
export interface PublicVerificationExpected {
  buildDigest: string;
  scriptDigest: string;
  styleDigest: string;
  routes: { path: string; canonical: string; title: string }[];
  journeySteps: {
    action:
      | 'navigate'
      | 'product'
      | 'cart-add'
      | 'cart-read'
      | 'checkout-review';
    path: string;
  }[];
  assets: Record<string, string>;
  publicationRevision: number;
}
/** Observations come from trusted browser/network inspection, never a model flag. */
export async function verifyPublicExperience(
  expected: PublicVerificationExpected,
  deps: {
    observe(): Promise<unknown>;
    current(): Promise<{ buildDigest: string; publicationRevision: number }>;
    record(markerDigest: string): Promise<void>;
  }
) {
  const observed = observation.parse(await deps.observe());
  if (
    observed.parentBuild !== expected.buildDigest ||
    observed.frameBuild !== expected.buildDigest ||
    observed.scriptDigest !== expected.scriptDigest ||
    observed.styleDigest !== expected.styleDigest ||
    JSON.stringify(
      observed.routes
        .map(({ path, canonical, title }) => ({ path, canonical, title }))
        .sort((a, b) => a.path.localeCompare(b.path))
    ) !==
      JSON.stringify(
        expected.routes
          .map(({ path, canonical, title }) => ({ path, canonical, title }))
          .sort((a, b) => a.path.localeCompare(b.path))
      ) ||
    expected.journeySteps.length === 0 ||
    JSON.stringify(
      observed.journey.steps.map(({ action, path }) => ({ action, path }))
    ) !== JSON.stringify(expected.journeySteps) ||
    JSON.stringify(Object.entries(observed.assets).sort()) !==
      JSON.stringify(Object.entries(expected.assets).sort())
  )
    throw Error('PUBLIC_VERIFICATION_FAILED');
  const current = await deps.current();
  if (
    current.buildDigest !== expected.buildDigest ||
    current.publicationRevision !== expected.publicationRevision
  )
    throw Error('PUBLICATION_SUPERSEDED');
  const marker = digestBytes(JSON.stringify(observed));
  await deps.record(marker);
  return { status: 'verified' as const, markerDigest: marker };
}
