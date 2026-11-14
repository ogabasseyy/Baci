import { z } from 'zod';
import { createPublicObservationAdapter } from './public-verification-observer';

/** Trusted co-located startup only: the receipt must come from the fixed helper preflight. */
export async function createQualifiedPublicObserver(settings: {
  productOrigin: string;
  toolchainDigest: string;
  verifyInstallation(): Promise<{ toolchainDigest: string }>;
  execute?: NonNullable<Parameters<typeof createPublicObservationAdapter>[1]>;
}) {
  const expected = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(settings.toolchainDigest);
  const receipt = await settings.verifyInstallation();
  if (receipt.toolchainDigest !== expected) throw Error('TOOLCHAIN_MISMATCH');
  const observe = createPublicObservationAdapter(
    settings.productOrigin,
    settings.execute
  );
  let active = false;
  let unavailable = false;
  return async (...args: Parameters<typeof observe>) => {
    if (unavailable) throw Error('PUBLIC_OBSERVER_UNAVAILABLE');
    if (active) throw Error('PUBLIC_OBSERVER_BUSY');
    active = true;
    try {
      return await observe(...args);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'PUBLIC_OBSERVATION_CLEANUP_FAILED' ||
          error.message === 'PUBLIC_OBSERVATION_PREPARE_UNCERTAIN')
      )
        unavailable = true;
      throw error;
    } finally {
      active = false;
    }
  };
}
