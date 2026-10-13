import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createRemediationFallbackStore } from './remediation-state-fallback.mjs';
import {
  matchingHandledEntry,
  remediationObservationFor as observationFor,
  remediationStateKeyFor,
} from './remediation-state-key.mjs';
import { normalizeRemediationNotifications } from './remediation-state-notifications.mjs';

const MAX_ENTRIES = 2_000;
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000;
const STALE_LOCK_MS = 2 * 60 * 1_000;
function capHandledEntries(handled) {
  return Object.fromEntries(
    Object.entries(handled)
      .sort(([, left], [, right]) =>
        right.recordedAt.localeCompare(left.recordedAt)
      )
      .slice(0, MAX_ENTRIES)
  );
}
const isIsoDate = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
function normalizeObservedEntries(value, timeField) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([fingerprint, entry]) =>
        fingerprint &&
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.observation === 'string' &&
        isIsoDate(entry[timeField])
    )
  );
}
function readState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.version !== 1 && parsed?.version !== 2) {
      return { handled: {}, notifications: {}, reservations: {} };
    }
    return {
      handled: normalizeObservedEntries(parsed.handled, 'recordedAt'),
      notifications: normalizeRemediationNotifications(parsed.notifications),
      reservations: normalizeObservedEntries(parsed.reservations, 'expiresAt'),
    };
  } catch {
    return { handled: {}, notifications: {}, reservations: {} };
  }
}
function persistState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ ...state, version: 2 }, null, 2)}\n`,
    { mode: 0o600 }
  );
  renameSync(temporaryPath, path);
}

function acquireLock(path, nowMs) {
  const lockPath = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { descriptor: openSync(lockPath, 'wx', 0o600), lockPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const modifiedAt = statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs;
      if (attempt === 0 && modifiedAt && nowMs - modifiedAt > STALE_LOCK_MS) {
        unlinkSync(lockPath);
        continue;
      }
      return null;
    }
  }
  return null;
}

function withStateLock(path, nowMs, fallback, action) {
  const lock = acquireLock(path, nowMs);
  if (!lock) return fallback;
  try {
    return action(readState(path));
  } finally {
    closeSync(lock.descriptor);
    unlinkSync(lock.lockPath);
  }
}

export function createRemediationState({
  now = () => Date.now(),
  path,
  reservationTtlMs = DEFAULT_RESERVATION_TTL_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const fallbackStore = createRemediationFallbackStore(path);
  return {
    pending(candidates, { limit = Number.POSITIVE_INFINITY } = {}) {
      const nowMs = now();
      return withStateLock(path, nowMs, [], (state) => {
        const recordedAt = new Date(nowMs).toISOString();
        const reconciledCandidates = fallbackStore.reconcile(
          state,
          candidates,
          recordedAt
        );
        state.handled = capHandledEntries(state.handled);
        for (const [fingerprint, reservation] of Object.entries(
          state.reservations
        )) {
          if (Date.parse(reservation.expiresAt) <= nowMs) {
            delete state.reservations[fingerprint];
          }
        }
        const selected = [];
        for (const candidate of candidates) {
          if (selected.length >= limit) break;
          const observation = observationFor(candidate);
          const key = remediationStateKeyFor(candidate);
          if (!key) continue;
          if (
            state.handled[key]?.observation !== observation &&
            state.reservations[key]?.observation !== observation
          ) {
            selected.push(candidate);
          }
        }
        const expiresAt = new Date(nowMs + reservationTtlMs).toISOString();
        for (const candidate of selected) {
          state.reservations[remediationStateKeyFor(candidate)] = {
            expiresAt,
            observation: observationFor(candidate),
            recordedAt,
          };
        }
        persistState(path, state);
        for (const candidate of reconciledCandidates) {
          fallbackStore.clear(candidate);
        }
        return selected;
      });
    },
    complete({
      deferCandidates = [],
      handledCandidates = [],
      notification,
      releaseCandidates = [],
    }) {
      const nowMs = now();
      return withStateLock(path, nowMs, false, (state) => {
        const recordedAt = new Date(nowMs).toISOString();
        for (const candidate of handledCandidates) {
          const key = remediationStateKeyFor(candidate);
          if (!key) continue;
          state.handled[key] = {
            observation: observationFor(candidate),
            recordedAt,
          };
          delete state.reservations[key];
        }
        for (const candidate of releaseCandidates) {
          const key = remediationStateKeyFor(candidate);
          if (key) delete state.reservations[key];
        }
        const retryAt = new Date(nowMs + retryDelayMs).toISOString();
        for (const candidate of deferCandidates) {
          const key = remediationStateKeyFor(candidate);
          if (!key) continue;
          state.reservations[key] = {
            expiresAt: retryAt,
            observation: observationFor(candidate),
            recordedAt,
          };
        }
        state.handled = capHandledEntries(state.handled);
        if (notification) {
          state.notifications[notification.id] = {
            recordedAt,
            report: notification.report,
          };
        }
        const notificationCutoff = nowMs - NOTIFICATION_RETENTION_MS;
        state.notifications = Object.fromEntries(
          Object.entries(state.notifications)
            .filter(
              ([, entry]) => Date.parse(entry.recordedAt) >= notificationCutoff
            )
            .sort(([, left], [, right]) =>
              right.recordedAt.localeCompare(left.recordedAt)
            )
            .slice(0, MAX_ENTRIES)
        );
        persistState(path, state);
        for (const candidate of handledCandidates) {
          fallbackStore.clear(candidate);
        }
        return true;
      });
    },
    recordHandledFallback(candidates) {
      const recordedAt = new Date(now()).toISOString();
      for (const candidate of candidates) {
        if (remediationStateKeyFor(candidate)) {
          fallbackStore.persist(candidate, recordedAt);
        }
      }
    },
    mark(candidates) {
      return this.complete({ handledCandidates: candidates });
    },
    handledCandidates(candidates) {
      return withStateLock(path, now(), false, ({ handled }) =>
        candidates.filter((candidate) =>
          Boolean(matchingHandledEntry(handled, candidate))
        )
      );
    },
    notifications({ limit = Number.POSITIVE_INFINITY, nowMs = now() } = {}) {
      const maximum =
        Number.isSafeInteger(limit) && limit > 0
          ? limit
          : Number.POSITIVE_INFINITY;
      return Object.entries(readState(path).notifications)
        .filter(
          ([, entry]) =>
            !entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) <= nowMs
        )
        .sort(
          ([, left], [, right]) =>
            Date.parse(left.nextAttemptAt || left.recordedAt) -
              Date.parse(right.nextAttemptAt || right.recordedAt) ||
            left.recordedAt.localeCompare(right.recordedAt)
        )
        .slice(0, maximum)
        .map(([id, entry]) => ({
          ...(entry.attempts ? { attempts: entry.attempts } : {}),
          id,
          report: entry.report,
        }));
    },
    scheduleNotificationRetry(id, nextAttemptAt) {
      if (!isIsoDate(nextAttemptAt)) return false;
      const nowMs = now();
      return withStateLock(path, nowMs, false, (state) => {
        const notification = state.notifications[id];
        if (!notification) return true;
        notification.attempts = Math.min(
          (notification.attempts || 0) + 1,
          Number.MAX_SAFE_INTEGER
        );
        notification.nextAttemptAt = nextAttemptAt;
        persistState(path, state);
        return true;
      });
    },
    acknowledgeNotification(id) {
      const nowMs = now();
      return withStateLock(path, nowMs, false, (state) => {
        if (!state.notifications[id]) return true;
        delete state.notifications[id];
        persistState(path, state);
        return true;
      });
    },
  };
}
