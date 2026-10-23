import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processAiStorefrontJobs } from './process-ai-storefront-jobs';
const mocks = vi.hoisted(() => ({
  processStorefrontLayoutJob: vi.fn(),
  privateStorage: false,
}));

vi.mock('@/lib/ai-storefront/process-storefront-layout-job', () => ({
  processStorefrontLayoutJob: mocks.processStorefrontLayoutJob,
}));

vi.mock('@/config/builder-private-storage', () => ({ get BUILDER_PRIVATE_STORAGE_ENABLED() { return mocks.privateStorage; } }));

vi.mock('@/env', () => ({
  getOllamaStorefrontModel: () => 'gemma4:e4b',
}));
interface RunnerSupabaseMockOptions {
  queryError?: Error;
  claimError?: Error;
  completeError?: Error;
  completeLostLease?: boolean;
  failError?: Error;
  failLostLease?: boolean;
  initialAttempts?: number;
  initialError?: string | null;
  privateSnapshot?: unknown;
  initialStatus?: 'pending' | 'processing';
}

function createRunnerSupabaseMock(options: RunnerSupabaseMockOptions = {}) {
  const updates: unknown[] = [];
  const limits: number[] = [];
  const selectedEqCalls: unknown[][] = [];
  const updateEqCalls: unknown[][] = [];
  const updateLteCalls: unknown[][] = [];
  const updateOrCalls: unknown[][] = [];
  let updateCount = 0;
  const job = {
    id: 'job-1',
    merchant_id: 'merchant-1',
    input: {
      pageSlug: 'home',
      businessName: 'Bassey Phones',
      businessType: 'electronics',
      brandColors: null,
      createdPageConfigUpdatedAt: null,
      ...(options.privateSnapshot === undefined ? {} : { starterConfig: options.privateSnapshot }),
    },
    attempts: options.initialAttempts ?? 0,
    max_attempts: 3,
    created_at: '2026-04-28T10:00:00.000Z',
    error: options.initialError ?? null,
    metadata: {},
    status: options.initialStatus ?? 'pending',
  };

  const supabase = {
    limits,
    updates,
    selectedEqCalls,
    updateEqCalls,
    updateLteCalls,
    updateOrCalls,
    from: vi.fn((table: string) => {
      if (table !== 'ai_jobs') throw new Error(`Unexpected table ${table}`);

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function eq(this: unknown, ...args: unknown[]) {
          selectedEqCalls.push(args);
          return this;
        }),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn((limit: number) => {
          limits.push(limit);
          return {
            returns: vi.fn().mockResolvedValue({
              data: options.queryError ? null : [job],
              error: options.queryError ?? null,
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          updates.push(payload);
          updateCount += 1;
          const isClaimUpdate = updateCount === 1;
          const isFailureUpdate =
            typeof payload === 'object' &&
            payload !== null &&
            'error' in payload &&
            (!('status' in payload) || payload.status !== 'completed');
          const updateError = isClaimUpdate
            ? options.claimError
            : isFailureUpdate
              ? options.failError
              : options.completeError;
          const lostLease = isClaimUpdate
            ? false
            : isFailureUpdate
              ? options.failLostLease
              : options.completeLostLease;
          const returnedJob =
            isClaimUpdate &&
            typeof payload === 'object' &&
            payload !== null &&
            'attempts' in payload
              ? { ...job, attempts: (payload as { attempts: number }).attempts }
              : job;
          return {
            eq: vi.fn(function eq(this: unknown, ...args: unknown[]) {
              updateEqCalls.push(args);
              return this;
            }),
            lte: vi.fn(function lte(this: unknown, ...args: unknown[]) {
              updateLteCalls.push(args);
              return this;
            }),
            or: vi.fn(function or(this: unknown, ...args: unknown[]) {
              updateOrCalls.push(args);
              return this;
            }),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: updateError || lostLease ? null : returnedJob,
              error: updateError ?? null,
            }),
          };
        }),
      };
    }),
  };

  return supabase;
}

describe('processAiStorefrontJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.privateStorage = false;
    mocks.processStorefrontLayoutJob.mockResolvedValue({
      generatedConfig: { content: [], root: { title: 'Home' }, zones: {} },
      applied: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves server-captured private snapshots only with private storage enabled', async () => {
    const snapshot = { content: [], root: { title: 'Private' } };
    mocks.privateStorage = true;
    await processAiStorefrontJobs({ supabase: createRunnerSupabaseMock({ privateSnapshot: snapshot }), workerId: 'private-worker' });
    expect(mocks.processStorefrontLayoutJob).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ starterConfig: snapshot }) }));
    mocks.processStorefrontLayoutJob.mockClear();
    mocks.privateStorage = false;
    await processAiStorefrontJobs({ supabase: createRunnerSupabaseMock({ privateSnapshot: snapshot }), workerId: 'private-worker' });
    expect(mocks.processStorefrontLayoutJob).not.toHaveBeenCalled();
  });

  it('claims only storefront generation jobs with the default batch size', async () => {
    const supabase = createRunnerSupabaseMock();

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.selectedEqCalls).toContainEqual([
      'type',
      'storefront_layout_generation',
    ]);
    expect(supabase.limits).toEqual([1]);
    expect(mocks.processStorefrontLayoutJob).toHaveBeenCalledTimes(1);
    expect(supabase.updates[0]).toEqual(
      expect.objectContaining({
        attempts: 1,
        status: 'processing',
        locked_by: 'worker-1',
        lease_expires_at: expect.any(String),
      })
    );
    expect(supabase.updates[1]).toEqual(
      expect.objectContaining({
        status: 'completed',
        locked_by: null,
        lease_expires_at: null,
      })
    );
  });

  it('claims pending jobs without a PostgREST OR filter on the update query', async () => {
    const supabase = createRunnerSupabaseMock();

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.updateEqCalls).toContainEqual(['id', 'job-1']);
    expect(supabase.updateEqCalls).toContainEqual(['status', 'pending']);
    expect(supabase.updateOrCalls).toEqual([]);
  });

  it('claims processing jobs only when their lease is expired', async () => {
    const supabase = createRunnerSupabaseMock({
      initialStatus: 'processing',
    });

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.updateEqCalls).toContainEqual(['id', 'job-1']);
    expect(supabase.updateEqCalls).toContainEqual(['status', 'processing']);
    expect(supabase.updateLteCalls).toEqual([
      ['lease_expires_at', expect.any(String)],
    ]);
    expect(supabase.updateOrCalls).toEqual([]);
  });

  it('clears stale retry fields when a previously failed job completes', async () => {
    const supabase = createRunnerSupabaseMock({
      initialAttempts: 1,
      initialError: 'Previous model validation failed',
    });

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.updates[1]).toEqual(
      expect.objectContaining({
        status: 'completed',
        error: null,
        next_run_at: expect.any(String),
      })
    );
  });

  it('allows operators to increase worker batch size', async () => {
    vi.stubEnv('STOREFRONT_AI_WORKER_BATCH_SIZE', '5');
    const supabase = createRunnerSupabaseMock();

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.limits).toEqual([5]);
  });

  it('retries failed jobs and records failure metadata', async () => {
    mocks.processStorefrontLayoutJob.mockRejectedValueOnce(
      new Error('Generated page config failed validation')
    );
    const supabase = createRunnerSupabaseMock();

    await processAiStorefrontJobs({
      supabase,
      now: new Date('2026-04-28T10:10:00.000Z'),
      workerId: 'worker-1',
    });

    expect(supabase.updates[1]).toEqual(
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        error: 'Generated page config failed validation',
        locked_by: null,
      })
    );
    expect(supabase.updates[1]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          validationOrGenerationError: 'Generated page config failed validation',
        }),
      })
    );
  });

  it('throws when the claim query returns an error', async () => {
    const supabase = createRunnerSupabaseMock({
      claimError: new Error('claim failed'),
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).rejects.toThrow('Failed to claim storefront job job-1: claim failed');
  });

  it('throws when the pending job query fails', async () => {
    const supabase = createRunnerSupabaseMock({
      queryError: new Error('query failed'),
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).rejects.toThrow('Failed to load storefront jobs: query failed');
  });

  it('continues the batch when completed-job persistence fails', async () => {
    const supabase = createRunnerSupabaseMock({
      completeError: new Error('update failed'),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected persistence logs.
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).resolves.toBe(0);
  });

  it('continues the batch when completed-job persistence loses the active lease', async () => {
    const supabase = createRunnerSupabaseMock({
      completeLostLease: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected persistence logs.
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).resolves.toBe(0);
  });

  it('continues the batch when failed-job persistence fails', async () => {
    mocks.processStorefrontLayoutJob.mockRejectedValueOnce(
      new Error('generation failed')
    );
    const supabase = createRunnerSupabaseMock({
      failError: new Error('failure update failed'),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected persistence logs.
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).resolves.toBe(0);
  });

  it('continues the batch when failed-job persistence loses the active lease', async () => {
    mocks.processStorefrontLayoutJob.mockRejectedValueOnce(
      new Error('generation failed')
    );
    const supabase = createRunnerSupabaseMock({
      failLostLease: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected persistence logs.
    });

    await expect(
      processAiStorefrontJobs({
        supabase,
        now: new Date('2026-04-28T10:10:00.000Z'),
        workerId: 'worker-1',
      })
    ).resolves.toBe(0);
  });
});
