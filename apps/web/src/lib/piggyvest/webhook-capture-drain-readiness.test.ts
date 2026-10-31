import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type CaptureDrainLoginEvidence,
  captureDrainCronState,
  collectCaptureDrainEvidence,
  drainLoginReason,
  drainScheduleReason,
} from './webhook-capture-drain-readiness';
import type { CaptureDrainExecutor } from './webhook-capture-pg-executor';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const WORKERS = '/srv/baci-worker/baci-workers';
const CRON_LINE = `* * * * * flock -n ${WORKERS}/locks/piggyvest-webhook-capture-drain.lock bash -lc 'export NODE_ENV=production && cd ${WORKERS} && timeout --signal=TERM --kill-after=10s 50s ${WORKERS}/bin/process-piggyvest-webhook-capture-drain.sh --once' >> ${WORKERS}/logs/piggyvest-webhook-capture-drain.log 2>&1`;
const status = {
  pending: 0,
  claimed: 0,
  needsReview: 0,
  oldestUnprocessedAt: null,
  lastCapturedAt: null,
  lastProcessedAt: null,
};

describe('captureDrainCronState', () => {
  it('finds exactly one active every-minute entry for the drain wrapper', () => {
    expect(
      captureDrainCronState(`# >>> baci-workers >>>\n${CRON_LINE}\n`)
    ).toBe('installed');
  });

  it.each([
    ['no crontab', null, 'unreadable'],
    ['an empty crontab', '', 'missing'],
    ['a commented-out entry', `# ${CRON_LINE}`, 'missing'],
    [
      'an entry without the lock',
      CRON_LINE.replace('flock -n ', ''),
      'missing',
    ],
    [
      'an entry on another schedule',
      CRON_LINE.replace('* * * * *', '*/5 * * * *'),
      'missing',
    ],
    ['a duplicated entry', `${CRON_LINE}\n${CRON_LINE}`, 'duplicated'],
  ])('reports %s', (_label, crontab, state) => {
    expect(captureDrainCronState(crontab)).toBe(state);
  });
});

describe('gate reasons', () => {
  it('names a missing check rather than passing it', () => {
    expect(drainLoginReason(undefined)).toBe('DRAIN_LOGIN_NOT_CHECKED');
    expect(drainScheduleReason(undefined)).toBe('DRAIN_SCHEDULE_NOT_CHECKED');
  });

  it.each<[CaptureDrainLoginEvidence, string | null]>([
    [{ ok: true } as const, null],
    [{ ok: false, reason: 'not_configured' }, 'DRAIN_LOGIN_NOT_CONFIGURED'],
    [{ ok: false, reason: 'unreachable' }, 'DRAIN_LOGIN_UNREACHABLE'],
    [
      { ok: false, reason: 'unsafe', failedChecks: ['tls'] },
      'DRAIN_LOGIN_UNSAFE',
    ],
  ])('maps login evidence %j to %s', (login, reason) => {
    expect(
      drainLoginReason({
        login,
        schedule: { enabled: true, cron: 'installed' },
      })
    ).toBe(reason);
  });

  it.each([
    [{ enabled: true, cron: 'installed' } as const, null],
    [{ enabled: false, cron: 'installed' } as const, 'DRAIN_NOT_ENABLED'],
    [{ enabled: true, cron: 'missing' } as const, 'DRAIN_CRON_NOT_INSTALLED'],
    [{ enabled: true, cron: 'duplicated' } as const, 'DRAIN_CRON_DUPLICATED'],
    [{ enabled: true, cron: 'unreadable' } as const, 'DRAIN_CRON_UNREADABLE'],
  ])('maps schedule evidence %j to %s', (schedule, reason) => {
    expect(drainScheduleReason({ login: { ok: true }, schedule })).toBe(reason);
  });
});

function executor(
  overrides: Partial<CaptureDrainExecutor> = {}
): CaptureDrainExecutor {
  return {
    query: async (statement) => (statement === 'status' ? [{ status }] : []),
    verifySession: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('collectCaptureDrainEvidence', () => {
  const env = {
    NODE_ENV: 'test',
    PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED: 'true',
  } as const;

  it('reads storage and the session through the drain login, and the schedule from the host', async () => {
    const query = vi.fn(executor().query);
    const evidence = await collectCaptureDrainEvidence({
      env,
      now: NOW,
      executor: executor({ query }),
      readCrontab: async () => CRON_LINE,
    });
    expect(evidence).toEqual({
      env,
      now: NOW,
      storage: { ok: true, status },
      drain: {
        login: { ok: true },
        schedule: { enabled: true, cron: 'installed' },
      },
    });
    expect(query).toHaveBeenCalledWith('status', []);
    expect(query).not.toHaveBeenCalledWith('claim', expect.anything());
  });

  it('reports an unconfigured login without connecting', async () => {
    const evidence = await collectCaptureDrainEvidence({
      env: { NODE_ENV: 'test' },
      now: NOW,
      executor: null,
      readCrontab: async () => null,
    });
    expect(evidence.storage).toEqual({ ok: false, reason: 'unreachable' });
    expect(evidence.drain).toEqual({
      login: { ok: false, reason: 'not_configured' },
      schedule: { enabled: false, cron: 'unreadable' },
    });
  });

  it.each([
    ['42883', 'function_missing'],
    ['42501', 'function_missing'],
    ['08006', 'unreachable'],
    [null, 'unreachable'],
  ])('classifies a status failure with SQLSTATE %s as %s', async (sqlState, reason) => {
    const failing = executor({
      query: async () => {
        throw Object.assign(
          new Error('PiggyVest capture drain database unavailable'),
          { sqlState }
        );
      },
    });
    const evidence = await collectCaptureDrainEvidence({
      env,
      now: NOW,
      executor: failing,
      readCrontab: async () => CRON_LINE,
    });
    expect(evidence.storage).toEqual({ ok: false, reason });
  });

  it('keeps an unsafe session verdict and a crontab read failure distinct', async () => {
    const evidence = await collectCaptureDrainEvidence({
      env,
      now: NOW,
      executor: executor({
        verifySession: async () => ({
          ok: false,
          reason: 'unsafe',
          failedChecks: ['membership'],
        }),
      }),
      readCrontab: async () => {
        throw new Error('crontab: permission denied');
      },
    });
    expect(evidence.drain).toEqual({
      login: { ok: false, reason: 'unsafe', failedChecks: ['membership'] },
      schedule: { enabled: true, cron: 'unreadable' },
    });
  });
});
