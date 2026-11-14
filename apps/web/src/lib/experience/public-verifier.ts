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
const requiredJourney = [
  'navigate',
  'product',
  'cart-add',
  'cart-read',
  'checkout-review',
] as const;

function hasCompleteJourney(steps: PublicVerificationExpected['journeySteps']) {
  let next = 0;
  for (const step of steps) {
    if (step.action === requiredJourney[next]) next++;
  }
  return next === requiredJourney.length;
}

function matchesJourney(
  expected: PublicVerificationExpected,
  observed: PublicVerificationExpected['journeySteps']
) {
  if (observed.length !== expected.journeySteps.length) return false;
  const routePaths = new Set(expected.routes.map((route) => route.path));
  return observed.every((step, index) => {
    const required = expected.journeySteps[index];
    if (!required || step.action !== required.action) return false;
    if (step.path === required.path) return true;
    return (
      (step.action === 'cart-add' ||
        step.action === 'cart-read' ||
        step.action === 'checkout-review') &&
      routePaths.has(step.path)
    );
  });
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
    !hasCompleteJourney(expected.journeySteps) ||
    !matchesJourney(expected, observed.journey.steps) ||
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
