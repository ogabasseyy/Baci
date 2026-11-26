import {
  authenticateAdmin,
  parseIdempotencyKey,
  parseJsonBody,
  parseRollbackPayload,
} from './admin-auth';
import {
  buildEmbeddedRollbackAction,
  buildRollbackNoopCasAction,
  checkExpectedCurrentUpdate,
  cleanupPreparedRollbackArtifacts,
  type PreparedRollbackRelease,
  prepareRollbackRelease,
  shouldTargetRollbackToEmbedded,
} from './admin-rollback-prepare';
import {
  findRecordedRollback,
  mergeRollbackHistory,
  updateChannelPointerCas,
} from './admin-storage';
import { readStoredPointerOrError } from './stored-record-parser';
import type {
  OtaWorkerEnv,
  RollbackOperationResult,
  RollbackPayload,
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
  const fingerprint = JSON.stringify({
    targetUpdateId: payload.targetUpdateId ?? null,
    ...(payload.expectedCurrentUpdateId
      ? { expectedCurrentUpdateId: payload.expectedCurrentUpdateId }
      : {}),
    toEmbedded: Boolean(payload.toEmbedded),
  });
  const pointerKey = `channels/${channel}/${payload.platform}/${payload.runtimeVersion}/current.json`;

  const pointerRead = await readStoredPointerOrError(env, pointerKey);
  if (pointerRead instanceof Response) {
    return pointerRead;
  }
  const { state: initialState } = pointerRead;

  const earlyRecorded = idempotencyKey
    ? findRecordedRollback(initialState, idempotencyKey, fingerprint)
    : undefined;
  if (earlyRecorded?.status === 'mismatch') {
    return errorResponse(
      'Idempotency-Key was already used with a different rollback payload',
      409,
      'IDEMPOTENCY_KEY_MISMATCH'
    );
  }
  if (earlyRecorded?.status === 'match') {
    return jsonResponse(earlyRecorded.response);
  }
  const earlyExpectedErr = checkExpectedCurrentUpdate(payload, initialState);
  if (earlyExpectedErr) {
    return earlyExpectedErr;
  }

  let prepared: PreparedRollbackRelease | null = null;
  if (!shouldTargetRollbackToEmbedded(payload, initialState)) {
    const prepOrResponse = await prepareRollbackRelease(
      env,
      channel,
      payload,
      initialState,
      idempotencyKey
    );
    if (prepOrResponse instanceof Response) {
      return prepOrResponse;
    }
    if (!('alreadyActive' in prepOrResponse)) {
      prepared = prepOrResponse;
    }
  }

  const result = await updateChannelPointerCas(env, pointerKey, (existing) => {
    const recorded = idempotencyKey
      ? findRecordedRollback(existing, idempotencyKey, fingerprint)
      : undefined;
    if (recorded?.status === 'mismatch') {
      return {
        kind: 'error',
        response: errorResponse(
          'Idempotency-Key was already used with a different rollback payload',
          409,
          'IDEMPOTENCY_KEY_MISMATCH'
        ),
      };
    }
    if (recorded?.status === 'match') {
      return { kind: 'idempotent', result: recorded.response };
    }
    const casExpectedErr = checkExpectedCurrentUpdate(payload, existing);
    if (casExpectedErr) {
      return { kind: 'error', response: casExpectedErr };
    }

    const priorActiveId =
      existing?.mode === 'update'
        ? existing.updateId
        : existing?.previousUpdateId;
    if (shouldTargetRollbackToEmbedded(payload, existing)) {
      if (prepared) {
        return {
          kind: 'error',
          response: errorResponse(
            'Concurrent channel state changed during targetless rollback; retry',
            409
          ),
        };
      }
      return buildEmbeddedRollbackAction(
        existing,
        channel,
        payload.platform,
        payload.runtimeVersion,
        priorActiveId,
        idempotencyKey,
        fingerprint
      );
    }

    if (
      payload.targetUpdateId &&
      existing?.mode === 'update' &&
      (existing.updateId === payload.targetUpdateId ||
        existing.activeSourceUpdateId === payload.targetUpdateId)
    ) {
      return buildRollbackNoopCasAction(
        existing,
        channel,
        payload.platform,
        payload.runtimeVersion,
        idempotencyKey,
        fingerprint
      );
    }

    if (!prepared) {
      return {
        kind: 'error',
        response: errorResponse(
          'Concurrent channel state changed during rollback; retry',
          409
        ),
      };
    }

    if (
      !payload.targetUpdateId &&
      existing?.previousUpdateId !== prepared.sourceTargetId
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
      existing?.updatedAt &&
      Date.parse(existing.updatedAt) >= Date.parse(prepared.createdAt)
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
      updateId: prepared.releaseId,
      rolledBackToUpdateId: prepared.sourceTargetId,
    };
    const entry = idempotencyKey
      ? { key: idempotencyKey, fingerprint, response }
      : undefined;
    return {
      kind: 'write',
      state: {
        mode: 'update',
        updateId: prepared.releaseId,
        activeSourceUpdateId: prepared.sourceTargetId,
        ...(existing?.mode ? { previousMode: existing.mode } : {}),
        ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
        updatedAt: prepared.createdAt,
        ...(entry ? { lastRollback: entry } : {}),
        recentRollbacks: mergeRollbackHistory(existing, entry),
      },
    };
  });

  await cleanupPreparedRollbackArtifacts(env, prepared, result);

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
