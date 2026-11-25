import { nextMonotonicTimestamp, putImmutableRelease } from './admin-storage';
import { deriveDeterministicUuid } from './crypto';
import { readStoredReleaseOrError } from './stored-record-parser';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  RollbackPayload,
  StoredReleaseRecord,
} from './types';
import { errorResponse, jsonResponse, ValidationError } from './validation';

export interface PreparedRollbackRelease {
  releaseId: string;
  releaseKey: string;
  preparedKey: string;
  createdByRequest: boolean;
  createdAt: string;
  sourceTargetId: string;
}

export async function prepareRollbackRelease(
  env: OtaWorkerEnv,
  channel: string,
  payload: RollbackPayload,
  initialObj: { etag?: string; httpEtag?: string } | null,
  initialState: ChannelCurrentState | null,
  idempotencyKey?: string
): Promise<PreparedRollbackRelease | Response> {
  const sourceTargetId =
    payload.targetUpdateId ?? initialState?.previousUpdateId;
  if (!sourceTargetId) {
    return errorResponse(
      'No targetUpdateId provided and no previousUpdateId recorded for rollback',
      400
    );
  }

  if (
    payload.targetUpdateId &&
    initialState?.mode === 'update' &&
    (initialState.updateId === payload.targetUpdateId ||
      initialState.activeSourceUpdateId === payload.targetUpdateId)
  ) {
    return jsonResponse({
      ok: true,
      mode: 'update',
      channel,
      platform: payload.platform,
      runtimeVersion: payload.runtimeVersion,
      updateId: initialState.updateId,
      ...(initialState.activeSourceUpdateId &&
      initialState.activeSourceUpdateId !== initialState.updateId
        ? { rolledBackToUpdateId: initialState.activeSourceUpdateId }
        : {}),
    });
  }

  const sourceReleaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${sourceTargetId}.json`;
  const sourceRelease = await readStoredReleaseOrError(
    env,
    sourceReleaseKey,
    `Target update not found: ${sourceTargetId}`
  );
  if (sourceRelease instanceof Response) {
    return sourceRelease;
  }

  if (
    sourceRelease.id !== sourceTargetId ||
    sourceRelease.channel !== channel ||
    sourceRelease.platform !== payload.platform ||
    sourceRelease.runtimeVersion !== payload.runtimeVersion
  ) {
    return errorResponse('Corrupt release manifest in storage', 500);
  }

  let createdAt: string;
  try {
    createdAt = nextMonotonicTimestamp(
      initialState?.updatedAt,
      sourceRelease.createdAt
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  const pointerGeneration =
    initialObj?.etag ??
    initialObj?.httpEtag?.replace(/^"(.*)"$/, '$1') ??
    'none';
  const releaseId = idempotencyKey
    ? deriveDeterministicUuid(
        `rollback:${channel}:${payload.platform}:${payload.runtimeVersion}:${pointerGeneration}:${initialState?.updatedAt ?? 'initial'}:${sourceTargetId}:${idempotencyKey}`
      )
    : crypto.randomUUID().toLowerCase();

  const rollbackRelease: StoredReleaseRecord = {
    ...sourceRelease,
    id: releaseId,
    createdAt,
    rollbackOfUpdateId: sourceTargetId,
  };
  const preparedKey = `prepared-releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${releaseId}.json`;
  await env.OTA_BUCKET.put(
    preparedKey,
    JSON.stringify({
      releaseId,
      sourceTargetId,
      createdAt,
    }),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );

  const releaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${releaseId}.json`;
  const releaseResult = await putImmutableRelease(
    env,
    releaseKey,
    rollbackRelease,
    { ignoreCreatedAtOnMatch: Boolean(idempotencyKey) }
  );
  if (releaseResult.status === 'conflict') {
    return errorResponse('Rollback release ID collision; retry', 409);
  }

  return {
    releaseId,
    releaseKey,
    preparedKey,
    createdByRequest: releaseResult.status === 'created',
    createdAt: releaseResult.createdAt,
    sourceTargetId,
  };
}
