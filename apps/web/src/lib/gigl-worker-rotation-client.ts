import 'server-only';

import {
  createGiglTrackingWorkerClient,
  GiglWorkerTokenError,
} from './gigl-tracking-worker-client';
import { selectGiglWorkerCredential } from './gigl-worker-rotation';

export async function createRotatingGiglWorkerClient(
  env: Readonly<Record<string, string | undefined>>
) {
  const secondaryToken = env.GIGL_TRACKING_WORKER_TOKEN_SECONDARY?.trim();
  if (!secondaryToken) return createGiglTrackingWorkerClient(env);

  let secondary: ReturnType<typeof createGiglTrackingWorkerClient> | undefined;
  try {
    secondary = createGiglTrackingWorkerClient({
      ...env,
      GIGL_TRACKING_WORKER_TOKEN: secondaryToken,
    });
  } catch (error) {
    if (!(error instanceof GiglWorkerTokenError)) throw error;
  }
  let primary: ReturnType<typeof createGiglTrackingWorkerClient> | undefined;
  try {
    primary = createGiglTrackingWorkerClient(env);
  } catch (error) {
    if (!(error instanceof GiglWorkerTokenError)) throw error;
  }
  const probe = async (
    client: ReturnType<typeof createGiglTrackingWorkerClient>
  ) => {
    const { error, status } = await client.rpc(
      'claim_due_gigl_tracking_monitors',
      {
        p_limit: 0,
        p_worker_id: 'gigl-capability-preflight',
      }
    );
    if (error?.code === '22023') return 'valid' as const;
    if (
      status === 401 &&
      (error?.code === 'PGRST301' || error?.code === 'PGRST303')
    ) {
      return 'auth-rejected' as const;
    }
    return 'indeterminate' as const;
  };
  if (!primary && !secondary) {
    throw new GiglWorkerTokenError(
      'GIGL tracking worker database capability is invalid'
    );
  }
  return await (primary
    ? selectGiglWorkerCredential(primary, secondary, probe)
    : selectGiglWorkerCredential(secondary, undefined, probe));
}
