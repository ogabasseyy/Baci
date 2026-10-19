import { describe, expect, it, vi } from 'vitest';
import {
  runQuizFinalizationCli,
  runQuizFinalizationLoop,
} from './process-quiz-finalization';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  QUIZ_PHASE: '1a',
  QUIZ_PRODUCTION_APPROVED: 'false',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('process-quiz-finalization', () => {
  it('runs phase 1a without a cron secret and logs only bounded counts', async () => {
    const runJob = vi.fn().mockResolvedValue({
      body: { testClosed: 2, liveAwaitingGate: 1, failed: 0,
        details: 'player@example.com internal detail' }, status: 200,
    });
    const logger = { error: vi.fn(), info: vi.fn() };
    await expect(runQuizFinalizationCli({ env: baseEnv, logger, runJob })).resolves.toBe(0);
    const summary = logger.info.mock.calls[0]?.[1] as string;
    expect(JSON.parse(summary)).toEqual({ testClosed: 2, liveAwaitingGate: 1, failed: 0, status: 200 });
    expect(summary).not.toContain('player@example.com');
  });

  it('requires proof secrets before production processing', async () => {
    const runJob = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };
    await expect(runQuizFinalizationCli({ env: { ...baseEnv, QUIZ_PHASE: 'production',
      QUIZ_PRODUCTION_APPROVED: 'true' }, logger, runJob })).resolves.toBe(1);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('returns failure without exposing thrown details', async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    await expect(runQuizFinalizationCli({ env: baseEnv, logger,
      runJob: vi.fn().mockRejectedValue(new Error('private database detail')) })).resolves.toBe(1);
    expect(logger.error).toHaveBeenCalledWith('[quiz-finalization] failed');
  });

  it('runs finalization serially on the one-second deadline cadence', async () => {
    const runJob = vi.fn().mockResolvedValue({ body: { failed: 0 }, status: 200 });
    const delay = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('stop'));

    await expect(
      runQuizFinalizationLoop({ delay, env: baseEnv, logger: { error: vi.fn(), info: vi.fn() }, runJob })
    ).resolves.toBe(1);

    expect(runJob).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenNthCalledWith(1, 1_000);
  });
});
