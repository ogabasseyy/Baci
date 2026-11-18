import type { OxygenClient } from './client';
import { OxygenClientError } from './errors';
/** Network availability cannot hide owned progress. Invalid pins/auth still reject. */
export async function verifyOxygenCapabilities(
  client: OxygenClient
): Promise<boolean> {
  try {
    await client.capabilities();
    return true;
  } catch (error) {
    if (
      error instanceof OxygenClientError &&
      (error.code === 'transport' ||
        (error.code === 'http' && error.status === 503))
    )
      return false;
    throw error;
  }
}
