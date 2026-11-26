import {
  mergeRollbackHistory,
  nextMonotonicTimestamp,
  type PointerCasAction,
  putImmutableRelease,
} from './admin-storage';
import { deriveDeterministicUuid } from './crypto';
import { readStoredReleaseOrError } from './stored-record-parser';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  RollbackOperationResult,
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

export type RollbackPreparation =
  | PreparedRollbackRelease
  | { alreadyActive: true };

export async function prepareRollbackRelease(
  env: OtaWorkerEnv,
  channel: string,
  payload: RollbackPayload,
  initialObj: { etag?: string; httpEtag?: string } | null,
  initialState: ChannelCurrentState | null,
  idempotencyKey?: string
): Promise<RollbackPreparation | Response> {
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
    if (idempotencyKey) {
      return { alreadyActive: true };
    }
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

export function buildRollbackNoopCasAction(
  existing: Extract<ChannelCurrentState, { mode: 'update' }>,
  channel: string,
  platform: RollbackPayload['platform'],
  runtimeVersion: string,
  idempotencyKey: string | undefined,
  fingerprint: string
): PointerCasAction {
  if (!idempotencyKey) {
    return { kind: 'noop', state: existing };
  }
  const response: RollbackOperationResult = {
    ok: true,
    mode: 'update',
    channel,
    platform,
    runtimeVersion,
    updateId: existing.updateId,
    ...(existing.activeSourceUpdateId &&
    existing.activeSourceUpdateId !== existing.updateId
      ? { rolledBackToUpdateId: existing.activeSourceUpdateId }
      : {}),
  };
  const entry = { key: idempotencyKey, fingerprint, response };
  return {
    kind: 'write',
    state: {
      ...existing,
      lastRollback: entry,
      recentRollbacks: mergeRollbackHistory(existing, entry),
    },
  };
}

export async function cleanupPreparedRollbackArtifacts(
  env: OtaWorkerEnv,
  prepared: PreparedRollbackRelease | null,
  result:
    | { state: ChannelCurrentState }
    | { idempotentResult: RollbackOperationResult }
    | Response,
  idempotencyKey?: string
): Promise<void> {
  if (!prepared || !env.OTA_BUCKET.delete) {
    return;
  }
  const committedThisRelease =
    !(result instanceof Response) &&
    'state' in result &&
    result.state.mode === 'update' &&
    result.state.updateId === prepared.releaseId;
  try {
    if (committedThisRelease) {
      await env.OTA_BUCKET.delete(prepared.preparedKey);
    } else if (!idempotencyKey && prepared.createdByRequest) {
      await env.OTA_BUCKET.delete(prepared.releaseKey);
      await env.OTA_BUCKET.delete(prepared.preparedKey);
    }
  } catch (err) {
    console.warn(
      committedThisRelease
        ? 'Failed to clean up committed rollback marker'
        : 'Failed to clean up aborted rollback artifacts',
      err
    );
  }
}
