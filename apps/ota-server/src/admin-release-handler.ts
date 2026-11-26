import { authenticateAdmin } from './admin-auth';
import { readStoredReleaseOrError } from './stored-record-parser';
import type { OtaPlatform, OtaWorkerEnv } from './types';
import {
  errorResponse,
  jsonResponse,
  ValidationError,
  validateChannelName,
  validatePlatform,
  validateRuntimeVersion,
  validateUpdateId,
} from './validation';

export async function handleAdminGetRelease(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  const url = new URL(request.url);
  let channel: string;
  let platform: OtaPlatform;
  let runtimeVersion: string;
  let updateId: string;
  try {
    channel = validateChannelName(
      url.searchParams.get('channel') ?? 'production'
    );
    platform = validatePlatform(url.searchParams.get('platform'));
    runtimeVersion = validateRuntimeVersion(
      url.searchParams.get('runtimeVersion')
    );
    const rawUpdateId = url.searchParams.get('updateId');
    if (!rawUpdateId) {
      return errorResponse('Missing updateId query parameter', 400);
    }
    updateId = validateUpdateId(rawUpdateId);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const releaseKey = `releases/${channel}/${platform}/${runtimeVersion}/${updateId}.json`;
  const release = await readStoredReleaseOrError(
    env,
    releaseKey,
    `Target update not found: ${updateId}`
  );
  if (release instanceof Response) {
    return release;
  }

  if (
    release.id !== updateId ||
    release.channel !== channel ||
    release.platform !== platform ||
    release.runtimeVersion !== runtimeVersion
  ) {
    return errorResponse('Corrupt release manifest in storage', 500);
  }

  return jsonResponse({
    id: release.id,
    channel: release.channel,
    platform: release.platform,
    runtimeVersion: release.runtimeVersion,
    sourceSha: release.sourceSha ?? null,
    createdAt: release.createdAt,
    rollbackOfUpdateId: release.rollbackOfUpdateId ?? null,
  });
}
