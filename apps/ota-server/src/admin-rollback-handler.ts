import {
  authenticateAdmin,
  parseIdempotencyKey,
  parseJsonBody,
  parseRollbackPayload,
} from './admin-auth';
import {
  nextMonotonicTimestamp,
  putImmutableRelease,
  updateChannelPointerCas,
} from './admin-storage';
import { deriveDeterministicUuid } from './crypto';
import type {
  ChannelCurrentState,
  OtaWorkerEnv,
  RollbackOperationResult,
  RollbackPayload,
  StoredReleaseRecord,
} from './types';
import {
  errorResponse,
  jsonResponse,
  MAX_ROLLBACK_JSON_BYTES,
  ValidationError,
} from './validation';

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
  let headerIdempotencyKey: string | undefined;
  try {
    payload = parseRollbackPayload(
      await parseJsonBody(request, MAX_ROLLBACK_JSON_BYTES)
    );
    headerIdempotencyKey = parseIdempotencyKey(
      request.headers.get('idempotency-key')
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err.message, err.status);
    }
    throw err;
  }

  if (
    headerIdempotencyKey &&
    payload.idempotencyKey &&
    headerIdempotencyKey !== payload.idempotencyKey
  ) {
    return errorResponse(
      'Idempotency-Key header does not match body idempotencyKey',
      400
    );
  }
  const idempotencyKey = headerIdempotencyKey ?? payload.idempotencyKey;
  if (!payload.toEmbedded && !payload.targetUpdateId && !idempotencyKey) {
    return errorResponse(
      'Specify targetUpdateId or provide Idempotency-Key for targetless rollback',
      400
    );
  }

  const channel = payload.channel ?? 'production';
  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;

  const initialObj = await env.OTA_BUCKET.get(pointerKey);
  const initialState = initialObj
    ? await initialObj.json<ChannelCurrentState>()
    : null;

  if (idempotencyKey && initialState?.lastRollback?.key === idempotencyKey) {
    return jsonResponse(initialState.lastRollback.response);
  }

  let preparedRollback: {
    releaseId: string;
    createdAt: string;
    sourceTargetId: string;
  } | null = null;

  if (!payload.toEmbedded) {
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
    const sourceObj = await env.OTA_BUCKET.get(sourceReleaseKey);
    if (!sourceObj) {
      return errorResponse(`Target update not found: ${sourceTargetId}`, 404);
    }
    const sourceRelease = await sourceObj.json<StoredReleaseRecord>();

    const createdAt = nextMonotonicTimestamp(
      initialState?.updatedAt,
      sourceRelease.createdAt
    );
    const rollbackReleaseId = idempotencyKey
      ? deriveDeterministicUuid(
          `rollback:${channel}:${payload.platform}:${payload.runtimeVersion}:${initialObj?.httpEtag ?? 'none'}:${initialState?.updatedAt ?? 'initial'}:${sourceTargetId}:${idempotencyKey}`
        )
      : crypto.randomUUID().toLowerCase();

    const rollbackRelease: StoredReleaseRecord = {
      ...sourceRelease,
      id: rollbackReleaseId,
      createdAt,
      rollbackOfUpdateId: sourceTargetId,
    };
    const rollbackReleaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${rollbackReleaseId}.json`;
    const releaseResult = await putImmutableRelease(
      env,
      rollbackReleaseKey,
      rollbackRelease,
      { ignoreCreatedAtOnMatch: Boolean(idempotencyKey) }
    );
    if (releaseResult.status === 'conflict') {
      return errorResponse('Rollback release ID collision; retry', 409);
    }

    preparedRollback = {
      releaseId: rollbackReleaseId,
      createdAt: releaseResult.createdAt,
      sourceTargetId,
    };
  }

  // Pure CAS callback: zero storage writes or non-deterministic ID generation inside retries.
  const result = await updateChannelPointerCas(env, pointerKey, (existing) => {
    if (idempotencyKey && existing?.lastRollback?.key === idempotencyKey) {
      return { kind: 'idempotent', result: existing.lastRollback.response };
    }

    const priorActiveId =
      existing?.mode === 'update'
        ? existing.updateId
        : existing?.previousUpdateId;

    if (payload.toEmbedded) {
      const now = nextMonotonicTimestamp(existing?.updatedAt);
      const response: RollbackOperationResult = {
        ok: true,
        mode: 'rollback_to_embedded',
        channel,
        platform: payload.platform,
        runtimeVersion: payload.runtimeVersion,
        commitTime: now,
      };
      return {
        kind: 'write',
        state: {
          mode: 'rollback_to_embedded',
          commitTime: now,
          ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
          updatedAt: now,
          ...(idempotencyKey
            ? { lastRollback: { key: idempotencyKey, response } }
            : {}),
        },
      };
    }

    if (!preparedRollback) {
      return {
        kind: 'error',
        response: errorResponse('Rollback release preparation missing', 500),
      };
    }

    if (
      !payload.targetUpdateId &&
      existing?.previousUpdateId !== preparedRollback.sourceTargetId
    ) {
      return {
        kind: 'error',
        response: errorResponse(
          'Concurrent channel state changed during targetless rollback; retry',
          409
        ),
      };
    }

    if (
      payload.targetUpdateId &&
      existing?.mode === 'update' &&
      (existing.updateId === payload.targetUpdateId ||
        existing.activeSourceUpdateId === payload.targetUpdateId)
    ) {
      return { kind: 'noop', state: existing };
    }

    if (
      existing?.updatedAt &&
      Date.parse(existing.updatedAt) >= Date.parse(preparedRollback.createdAt)
    ) {
      return {
        kind: 'error',
        response: errorResponse(
          'Concurrent update advanced channel timestamp during rollback; retry',
          409
        ),
      };
    }

    const response: RollbackOperationResult = {
      ok: true,
      mode: 'update',
      channel,
      platform: payload.platform,
      runtimeVersion: payload.runtimeVersion,
      updateId: preparedRollback.releaseId,
      rolledBackToUpdateId: preparedRollback.sourceTargetId,
    };
    return {
      kind: 'write',
      state: {
        mode: 'update',
        updateId: preparedRollback.releaseId,
        activeSourceUpdateId: preparedRollback.sourceTargetId,
        ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
        updatedAt: preparedRollback.createdAt,
        ...(idempotencyKey
          ? { lastRollback: { key: idempotencyKey, response } }
          : {}),
      },
    };
  });

  if (result instanceof Response) {
    return result;
  }
  if ('idempotentResult' in result) {
    return jsonResponse(result.idempotentResult);
  }
  const state = result.state;
  if (state.mode === 'rollback_to_embedded') {
    return jsonResponse({
      ok: true,
      mode: 'rollback_to_embedded',
      channel,
      platform: payload.platform,
      runtimeVersion: payload.runtimeVersion,
      commitTime: state.commitTime,
    });
  }
  return jsonResponse({
    ok: true,
    mode: 'update',
    channel,
    platform: payload.platform,
    runtimeVersion: payload.runtimeVersion,
    updateId: state.updateId,
    ...(state.activeSourceUpdateId &&
    state.activeSourceUpdateId !== state.updateId
      ? { rolledBackToUpdateId: state.activeSourceUpdateId }
      : {}),
  });
}
