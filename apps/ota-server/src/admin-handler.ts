import {
  authenticateAdmin,
  parseJsonBody,
  parsePublishPayload,
  parseRollbackPayload,
} from './admin-auth';
import { updateChannelPointerCas, verifyAssetIntegrity } from './admin-storage';
import { sha256Base64Url, sha256Hex } from './crypto';
import type {
  OtaWorkerEnv,
  PublishPayload,
  RollbackPayload,
  StoredReleaseRecord,
} from './types';
import {
  errorResponse,
  jsonResponse,
  ValidationError,
  validateAssetKey,
} from './validation';

const ADMIN_ASSETS_PREFIX = '/api/admin/assets/';
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

export async function handleAdminUploadAsset(
  request: Request,
  env: OtaWorkerEnv,
  pathname: string
): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  let assetKey: string;
  try {
    assetKey = validateAssetKey(pathname.slice(ADMIN_ASSETS_PREFIX.length));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const expectedSha256 = request.headers.get('x-asset-sha256')?.trim();
  if (!expectedSha256 || !SHA256_HEX_REGEX.test(expectedSha256)) {
    return errorResponse(
      'Missing or invalid x-asset-sha256 header (expected 64-char hex)',
      400
    );
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    return errorResponse('Asset body cannot be empty', 400);
  }

  const bytes = new Uint8Array(buffer);
  const actualSha256 = sha256Hex(bytes);
  if (expectedSha256.toLowerCase() !== actualSha256.toLowerCase()) {
    return errorResponse('Uploaded asset SHA-256 mismatch', 400);
  }
  const actualBase64Url = sha256Base64Url(bytes);

  const contentType =
    request.headers.get('content-type')?.trim() || 'application/octet-stream';
  const storageKey = `assets/${assetKey}`;

  await env.OTA_BUCKET.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      sha256Hex: actualSha256,
      sha256Base64Url: actualBase64Url,
    },
  });

  return jsonResponse({
    ok: true,
    r2Key: assetKey,
    storageKey,
    size: bytes.byteLength,
    sha256: actualSha256,
  });
}

export async function handleAdminPublish(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  let payload: PublishPayload;
  try {
    payload = parsePublishPayload(await parseJsonBody(request));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const channel = payload.channel ?? 'production';
  const updateId = payload.updateId ?? crypto.randomUUID().toLowerCase();
  const createdAt = payload.createdAt ?? new Date().toISOString();
  const assets = payload.assets ?? [];

  for (const asset of [payload.launchAsset, ...assets]) {
    const integrityError = await verifyAssetIntegrity(env, asset);
    if (integrityError) {
      return errorResponse(integrityError, 400);
    }
  }

  const releaseRecord: StoredReleaseRecord = {
    id: updateId,
    createdAt,
    runtimeVersion: payload.runtimeVersion,
    channel,
    platform: payload.platform,
    ...(payload.sourceSha ? { sourceSha: payload.sourceSha } : {}),
    launchAsset: payload.launchAsset,
    assets,
    metadata: payload.metadata ?? {},
    extra: payload.extra ?? {},
  };

  const releaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${updateId}.json`;
  await env.OTA_BUCKET.put(releaseKey, JSON.stringify(releaseRecord), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;
  const result = await updateChannelPointerCas(env, pointerKey, (existing) => {
    const previousUpdateId =
      existing?.mode === 'update' && existing.updateId !== updateId
        ? existing.updateId
        : existing?.previousUpdateId;
    return {
      mode: 'update',
      updateId,
      ...(previousUpdateId ? { previousUpdateId } : {}),
      updatedAt: new Date().toISOString(),
    };
  });

  if (result instanceof Response) {
    return result;
  }

  return jsonResponse({
    ok: true,
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId,
    ...(result.previousUpdateId
      ? { previousUpdateId: result.previousUpdateId }
      : {}),
  });
}

export async function handleAdminRollback(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }
  const authError = authenticateAdmin(request, env);
  if (authError) {
    return authError;
  }

  let payload: RollbackPayload;
  try {
    payload = parseRollbackPayload(await parseJsonBody(request));
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const channel = payload.channel ?? 'production';
  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;

  if (payload.targetUpdateId) {
    const targetReleaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${payload.targetUpdateId}.json`;
    const targetExists = await env.OTA_BUCKET.head(targetReleaseKey);
    if (!targetExists) {
      return errorResponse(
        `Target update not found: ${payload.targetUpdateId}`,
        404
      );
    }
  }

  const now = new Date().toISOString();
  const result = await updateChannelPointerCas(env, pointerKey, (existing) => {
    const priorActiveId =
      existing?.mode === 'update'
        ? existing.updateId
        : existing?.previousUpdateId;
    if (payload.toEmbedded) {
      return {
        mode: 'rollback_to_embedded',
        commitTime: now,
        ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
        updatedAt: now,
      };
    }
    const targetUpdateId = payload.targetUpdateId ?? existing?.previousUpdateId;
    if (!targetUpdateId) {
      return errorResponse(
        'No targetUpdateId provided and no previousUpdateId recorded for rollback',
        400
      );
    }
    return {
      mode: 'update',
      updateId: targetUpdateId,
      ...(priorActiveId && priorActiveId !== targetUpdateId
        ? { previousUpdateId: priorActiveId }
        : {}),
      updatedAt: now,
    };
  });

  if (result instanceof Response) {
    return result;
  }
  if (result.mode === 'rollback_to_embedded') {
    return jsonResponse({
      ok: true,
      mode: 'rollback_to_embedded',
      channel,
      platform: payload.platform,
      runtimeVersion: payload.runtimeVersion,
      commitTime: result.commitTime,
    });
  }
  return jsonResponse({
    ok: true,
    mode: 'update',
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId: result.updateId,
  });
}
