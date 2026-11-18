import { experiencePublicObservation } from '@/schemas/experience-public-verification';
import { digestBytes } from './manifest-digest';

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
  const observed = experiencePublicObservation.parse(await deps.observe());
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
