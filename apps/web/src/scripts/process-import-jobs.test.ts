import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  getImportJobWorkerBatchSize: vi.fn(),
  processImportJobById: vi.fn(),
  processImportJobQueue: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/import-jobs/process-import-job', () => ({
  processImportJobById: mocks.processImportJobById,
  processImportJobQueue: mocks.processImportJobQueue,
}));

vi.mock('@/env', () => ({
  getImportJobWorkerBatchSize: mocks.getImportJobWorkerBatchSize,
}));

import { runProcessImportJobsCli } from './process-import-jobs';

describe('runProcessImportJobsCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImportJobWorkerBatchSize.mockReturnValue(3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the import queue with the default batch size', async () => {
    const supabase = { service: true };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.processImportJobQueue.mockResolvedValue([
      { id: 'job-1', status: 'preview_ready' },
      { id: 'job-2', status: 'committed' },
    ]);

    const exitCode = await runProcessImportJobsCli();

    expect(exitCode).toBe(0);
    expect(mocks.processImportJobQueue).toHaveBeenCalledWith(supabase, 3);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      processed: 2,
      statusCounts: {
        preview_ready: 1,
        committed: 1,
      },
    });
  });

  it('uses a configured batch size and returns non-zero when a job fails', async () => {
    mocks.getImportJobWorkerBatchSize.mockReturnValue(7);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.processImportJobQueue.mockResolvedValue([
      { id: 'job-1', status: 'failed' },
    ]);

    const exitCode = await runProcessImportJobsCli();

    expect(exitCode).toBe(1);
    expect(mocks.processImportJobQueue).toHaveBeenCalledWith(
      { service: true },
      7
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      processed: 1,
      statusCounts: { failed: 1 },
    });
  });

  it('processes a single triggered job when IMPORT_JOB_TRIGGER_JOB_ID is set', async () => {
    const supabase = { service: true };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.processImportJobById.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'preview_ready',
      processed: 5903,
    });

    const exitCode = await runProcessImportJobsCli({
      env: {
        IMPORT_JOB_TRIGGER_JOB_ID: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(exitCode).toBe(0);
    expect(mocks.processImportJobById).toHaveBeenCalledWith(
      supabase,
      '11111111-1111-4111-8111-111111111111'
    );
    expect(mocks.processImportJobQueue).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      processed: 1,
      statusCounts: { preview_ready: 1 },
    });
  });

  it('returns non-zero when a triggered job is not claimed', async () => {
    const supabase = { service: true };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.processImportJobById.mockResolvedValue(null);

    const exitCode = await runProcessImportJobsCli({
      env: {
        IMPORT_JOB_TRIGGER_JOB_ID: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(exitCode).toBe(1);
    expect(mocks.processImportJobById).toHaveBeenCalledWith(
      supabase,
      '11111111-1111-4111-8111-111111111111'
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      processed: 0,
      statusCounts: {},
    });
    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      jobId: '11111111-1111-4111-8111-111111111111',
      message: 'Triggered import job was not claimed',
    });
  });

  it('returns non-zero when a triggered job fails', async () => {
    const supabase = { service: true };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.processImportJobById.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
    });

    const exitCode = await runProcessImportJobsCli({
      env: {
        IMPORT_JOB_TRIGGER_JOB_ID: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      processed: 1,
      statusCounts: { failed: 1 },
    });
  });

  it('rejects an invalid triggered job id', async () => {
    await expect(
      runProcessImportJobsCli({
        env: { IMPORT_JOB_TRIGGER_JOB_ID: 'not-a-uuid' },
      })
    ).rejects.toThrow('IMPORT_JOB_TRIGGER_JOB_ID must be a UUID');

    expect(mocks.processImportJobById).not.toHaveBeenCalled();
    expect(mocks.processImportJobQueue).not.toHaveBeenCalled();
  });
});

describe('process-import-jobs production env validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    vi.stubEnv('QUIZ_PHASE', '1a');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    delete process.env.QUIZ_RPC_SERVER_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK;
    delete process.env.BACI_WORKER_PROFILE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('succeeds in production phase 1a without QUIZ_RPC_SERVER_SECRET when BACI_WORKER_PROFILE is process-import-jobs', async () => {
    vi.stubEnv('BACI_WORKER_PROFILE', 'process-import-jobs');
    vi.doUnmock('@/env');
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: vi.fn(() => ({ service: true })),
    }));
    vi.doMock('@/lib/import-jobs/process-import-job', () => ({
      processImportJobById: vi.fn(),
      processImportJobQueue: vi.fn().mockResolvedValue([]),
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runProcessImportJobsCli: runWithRealEnv } = await import(
      './process-import-jobs'
    );

    await expect(runWithRealEnv()).resolves.toBe(0);
  });

  it('fails in production phase 1a without QUIZ_RPC_SERVER_SECRET when BACI_WORKER_PROFILE is missing (web runtime)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', 'jwt-secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doUnmock('@/env');

    await expect(import('./process-import-jobs')).rejects.toThrow(
      /QUIZ_RPC_SERVER_SECRET is required in production for negotiated checkout proofs/
    );
  });
});
