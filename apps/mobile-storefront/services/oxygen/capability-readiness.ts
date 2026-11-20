import type { OxygenClient } from './client';
import { OxygenClientError } from './errors';
/** Network availability cannot hide owned progress. Invalid pins/auth still reject. */
export async function readVerifiedOxygenCapabilities(client: OxygenClient) {
  try {
    return await client.capabilities();
  } catch (error) {
    if (
      error instanceof OxygenClientError &&
      (error.code === 'transport' ||
        (error.code === 'http' && error.status === 503))
    )
      return null;
    throw error;
  }
}
