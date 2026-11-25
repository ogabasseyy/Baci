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
import type {
  OtaWorkerEnv,
  RollbackOperationResult,
  RollbackPayload,
  StoredReleaseRecord,
} from './types';
import { errorResponse, jsonResponse, ValidationError } from './validation';

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
    payload = parseRollbackPayload(await parseJsonBody(request));
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

  const result = await updateChannelPointerCas(
    env,
    pointerKey,
    async (existing) => {
      if (idempotencyKey && existing?.lastRollback?.key === idempotencyKey) {
        return { kind: 'idempotent', result: existing.lastRollback.response };
      }

      const priorActiveId =
        existing?.mode === 'update'
          ? existing.updateId
          : existing?.previousUpdateId;
      const now = nextMonotonicTimestamp(existing?.updatedAt);

      if (payload.toEmbedded) {
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

      const sourceTargetId =
        payload.targetUpdateId ?? existing?.previousUpdateId;
      if (!sourceTargetId) {
        return {
          kind: 'error',
          response: errorResponse(
            'No targetUpdateId provided and no previousUpdateId recorded for rollback',
            400
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

      const sourceReleaseKey = `releases/${channel}/${payload.platform}/${payload.runtimeVersion}/${sourceTargetId}.json`;
      const sourceObj = await env.OTA_BUCKET.get(sourceReleaseKey);
      if (!sourceObj) {
        return {
          kind: 'error',
          response: errorResponse(
            `Target update not found: ${sourceTargetId}`,
            404
          ),
        };
      }
      const sourceRelease = await sourceObj.json<StoredReleaseRecord>();

      const rollbackReleaseId = crypto.randomUUID().toLowerCase();
      const createdAt = nextMonotonicTimestamp(
        existing?.updatedAt,
        sourceRelease.createdAt
      );
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
        rollbackRelease
      );
      if (releaseResult.status === 'conflict') {
        return {
          kind: 'error',
          response: errorResponse('Rollback release ID collision; retry', 409),
        };
      }

      const response: RollbackOperationResult = {
        ok: true,
        mode: 'update',
        channel,
        platform: payload.platform,
        runtimeVersion: payload.runtimeVersion,
        updateId: rollbackReleaseId,
        rolledBackToUpdateId: sourceTargetId,
      };
      return {
        kind: 'write',
        state: {
          mode: 'update',
          updateId: rollbackReleaseId,
          activeSourceUpdateId: sourceTargetId,
          ...(priorActiveId ? { previousUpdateId: priorActiveId } : {}),
          updatedAt: createdAt,
          ...(idempotencyKey
            ? { lastRollback: { key: idempotencyKey, response } }
            : {}),
        },
      };
    }
  );

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
