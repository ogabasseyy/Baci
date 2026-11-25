import {
  authenticateAdmin,
  parseJsonBody,
  parsePublishPayload,
  parseRollbackPayload,
} from './admin-auth';
import { sha256Hex } from './crypto';
import type {
  ChannelCurrentState,
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

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    return errorResponse('Asset body cannot be empty', 400);
  }

  const bytes = new Uint8Array(buffer);
  const actualSha256 = sha256Hex(bytes);
  const expectedSha256 = request.headers.get('x-asset-sha256')?.trim();
  if (
    expectedSha256 &&
    expectedSha256.toLowerCase() !== actualSha256.toLowerCase()
  ) {
    return errorResponse('Uploaded asset SHA-256 mismatch', 400);
  }

  const contentType =
    request.headers.get('content-type')?.trim() || 'application/octet-stream';
  const storageKey = `assets/${assetKey}`;

  await env.OTA_BUCKET.put(storageKey, bytes, {
    httpMetadata: { contentType },
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
    if (asset.r2Key) {
      const existing = await env.OTA_BUCKET.head(`assets/${asset.r2Key}`);
      if (!existing) {
        return errorResponse(
          `Referenced asset does not exist in R2: ${asset.r2Key}`,
          400
        );
      }
    }
  }

  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;
  const existingPointerObj = await env.OTA_BUCKET.get(pointerKey);
  const existingPointer = existingPointerObj
    ? await existingPointerObj.json<ChannelCurrentState>()
    : null;

  let previousUpdateId: string | undefined;
  if (
    existingPointer?.mode === 'update' &&
    existingPointer.updateId !== updateId
  ) {
    previousUpdateId = existingPointer.updateId;
  } else if (existingPointer?.previousUpdateId) {
    previousUpdateId = existingPointer.previousUpdateId;
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

  const nextPointer: ChannelCurrentState = {
    mode: 'update',
    updateId,
    ...(previousUpdateId ? { previousUpdateId } : {}),
    updatedAt: new Date().toISOString(),
  };

  await env.OTA_BUCKET.put(pointerKey, JSON.stringify(nextPointer), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return jsonResponse({
    ok: true,
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId,
    ...(previousUpdateId ? { previousUpdateId } : {}),
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
  const existingPointerObj = await env.OTA_BUCKET.get(pointerKey);
  const existingPointer = existingPointerObj
    ? await existingPointerObj.json<ChannelCurrentState>()
    : null;

  const priorActiveId =
    existingPointer?.mode === 'update'
      ? existingPointer.updateId
      : existingPointer?.previousUpdateId;
  const now = new Date().toISOString();

  if (payload.toEmbedded) {
    const embeddedPointer: ChannelCurrentState = {
      mode: 'rollback_to_embedded',
      commitTime: now,
      ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
      updatedAt: now,
    };
    await env.OTA_BUCKET.put(pointerKey, JSON.stringify(embeddedPointer), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    return jsonResponse({
      ok: true,
      mode: 'rollback_to_embedded',
      channel,
      platform: payload.platform,
      runtimeVersion: payload.runtimeVersion,
      commitTime: now,
    });
  }

  const targetUpdateId =
    payload.targetUpdateId ?? existingPointer?.previousUpdateId;
  if (!targetUpdateId) {
    return errorResponse(
      'No targetUpdateId provided and no previousUpdateId recorded for rollback',
      400
    );
  }

  const targetReleaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${targetUpdateId}.json`;
  const targetExists = await env.OTA_BUCKET.head(targetReleaseKey);
  if (!targetExists) {
    return errorResponse(`Target update not found: ${targetUpdateId}`, 404);
  }

  const rollbackPointer: ChannelCurrentState = {
    mode: 'update',
    updateId: targetUpdateId,
    ...(priorActiveId && priorActiveId !== targetUpdateId
      ? { previousUpdateId: priorActiveId }
      : {}),
    updatedAt: now,
  };

  await env.OTA_BUCKET.put(pointerKey, JSON.stringify(rollbackPointer), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return jsonResponse({
    ok: true,
    mode: 'update',
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId: targetUpdateId,
  });
}
