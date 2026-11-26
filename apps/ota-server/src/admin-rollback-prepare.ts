import {
  mergeRollbackHistory,
  nextMonotonicTimestamp,
  type PointerCasAction,
  putImmutableRelease,
} from './admin-storage';
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

  const releaseId = crypto.randomUUID().toLowerCase();

  const rollbackRelease: StoredReleaseRecord = {
    ...sourceRelease,
    id: releaseId,
    createdAt,
    rollbackOfUpdateId: sourceTargetId,
  };
  const releaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${releaseId}.json`;
  const releaseResult = await putImmutableRelease(
    env,
    releaseKey,
    rollbackRelease
  );
  if (releaseResult.status === 'conflict') {
    return errorResponse('Rollback release ID collision; retry', 409);
  }

  return {
    releaseId,
    releaseKey,
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

export function buildEmbeddedRollbackAction(
  existing: ChannelCurrentState | null,
  channel: string,
  platform: RollbackPayload['platform'],
  runtimeVersion: string,
  priorActiveId: string | undefined,
  idempotencyKey: string | undefined,
  fingerprint: string
): PointerCasAction {
  let now: string;
  try {
    now = nextMonotonicTimestamp(existing?.updatedAt);
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        kind: 'error',
        response: errorResponse(err.message, err.status),
      };
    }
    throw err;
  }
  const response: RollbackOperationResult = {
    ok: true,
    mode: 'rollback_to_embedded',
    channel,
    platform,
    runtimeVersion,
    commitTime: now,
  };
  const entry = idempotencyKey
    ? { key: idempotencyKey, fingerprint, response }
    : undefined;
  return {
    kind: 'write',
    state: {
      mode: 'rollback_to_embedded',
      commitTime: now,
      ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
      updatedAt: now,
      ...(entry ? { lastRollback: entry } : {}),
      recentRollbacks: mergeRollbackHistory(existing, entry),
    },
  };
}

export function checkExpectedCurrentUpdate(
  payload: RollbackPayload,
  state: ChannelCurrentState | null | undefined
): Response | null {
  if (
    payload.expectedCurrentUpdateId !== undefined &&
    (state?.mode !== 'update' ||
      state.updateId !== payload.expectedCurrentUpdateId)
  ) {
    return errorResponse(
      'Channel current update changed before rollback; aborting compensation',
      409,
      'EXPECTED_CURRENT_UPDATE_MISMATCH'
    );
  }
  return null;
}

export function shouldTargetRollbackToEmbedded(
  payload: RollbackPayload,
  state: ChannelCurrentState | null | undefined
): boolean {
  return (
    Boolean(payload.toEmbedded) ||
    (!payload.targetUpdateId &&
      state?.mode === 'update' &&
      state.previousMode === 'rollback_to_embedded')
  );
}

export async function cleanupPreparedRollbackArtifacts(
  env: OtaWorkerEnv,
  prepared: PreparedRollbackRelease | null,
  result:
    | { state: ChannelCurrentState }
    | { idempotentResult: RollbackOperationResult }
    | Response
    | null
): Promise<void> {
  if (!prepared || !env.OTA_BUCKET.delete || !prepared.createdByRequest) {
    return;
  }
  const reapedAfterDifferentOutcome =
    result !== null &&
    !(result instanceof Response) &&
    (('idempotentResult' in result &&
      (result.idempotentResult.mode !== 'update' ||
        result.idempotentResult.updateId !== prepared.releaseId)) ||
      ('state' in result &&
        (result.state.mode !== 'update' ||
          result.state.updateId !== prepared.releaseId)));
  if (
    result !== null &&
    !(result instanceof Response) &&
    !reapedAfterDifferentOutcome
  ) {
    return;
  }
  try {
    await env.OTA_BUCKET.delete(prepared.releaseKey);
  } catch (err) {
    console.warn('Failed to clean up aborted rollback release', err);
  }
}
