import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { storedStorefrontLayoutJobInputSchema } from '@/schemas/ai-jobs';
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getOllamaStorefrontModel } from '@/env';
import { processStorefrontLayoutJob } from '@/lib/ai-storefront/process-storefront-layout-job';
import { storefrontLayoutJobInputSchema } from '@/schemas/ai-jobs';

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;
const WORKER_LEASE_MS = 5 * 60_000;

interface ProcessAiStorefrontJobsOptions {
  supabase: SupabaseClient;
  now?: Date;
  workerId?: string;
}

interface StorefrontJobRow {
  id: string;
  merchant_id: string;
  status: string;
  input: unknown;
  attempts: number | null;
  max_attempts: number | null;
  created_at: string | null;
  metadata: unknown;
}

class StorefrontJobPersistenceError extends Error {
  override name = 'StorefrontJobPersistenceError';
}

function getBatchSize(): number {
  const parsed = Number(
    process.env.STOREFRONT_AI_WORKER_BATCH_SIZE ?? DEFAULT_BATCH_SIZE
  );
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
}

function getRetryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getWorkerId(): string {
  return process.env.AI_STOREFRONT_WORKER_ID ?? `vps-${randomUUID()}`;
}

function logStorefrontJobPersistenceError(error: unknown, jobId: string) {
  console.error('Storefront AI job persistence failed; continuing batch:', {
    jobId,
    error: error instanceof Error ? error.message : String(error),
  });
}

function createWorkerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase worker credentials');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function processAiStorefrontJobs({
  supabase,
  now = new Date(),
  workerId = getWorkerId(),
}: ProcessAiStorefrontJobsOptions): Promise<number> {
  const nowIso = now.toISOString();
  const { data: jobs, error } = await supabase
    .from('ai_jobs')
    .select(
      'id, merchant_id, input, attempts, max_attempts, created_at, metadata, status'
    )
    .eq('type', 'storefront_layout_generation')
    .or(
      `status.eq.pending,and(status.eq.processing,lease_expires_at.lte.${nowIso})`
    )
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(getBatchSize())
    .returns<StorefrontJobRow[]>();

  if (error) throw new Error(`Failed to load storefront jobs: ${error.message}`);
  if (!jobs?.length) return 0;

  let processed = 0;

  for (const job of jobs) {
    const claimStartedAt = Date.now();
    const claimTime = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
    const claimUpdate = supabase
      .from('ai_jobs')
      .update({
        status: 'processing',
        started_at: claimTime,
        locked_at: claimTime,
        locked_by: workerId,
        lease_expires_at: leaseExpiresAt,
        attempts: (job.attempts ?? 0) + 1,
      })
      .eq('id', job.id);

    const guardedClaimUpdate =
      job.status === 'processing'
        ? claimUpdate.eq('status', 'processing').lte('lease_expires_at', claimTime)
        : claimUpdate.eq('status', 'pending');

    const { data: claimedJob, error: claimError } = await guardedClaimUpdate
      .select(
        'id, merchant_id, status, input, attempts, max_attempts, created_at, metadata'
      )
      .maybeSingle<StorefrontJobRow>();

    if (claimError) {
      throw new Error(
        `Failed to claim storefront job ${job.id}: ${claimError.message}`
      );
    }

    if (!claimedJob) continue;

    try {
      const output = await processStorefrontLayoutJob({
        supabase,
        jobId: claimedJob.id,
        merchantId: claimedJob.merchant_id,
        input: (BUILDER_PRIVATE_STORAGE_ENABLED?storedStorefrontLayoutJobInputSchema:storefrontLayoutJobInputSchema).parse(claimedJob.input),
      });

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - claimStartedAt;
      const queueWaitMs =
        Date.now() - new Date(claimedJob.created_at ?? claimTime).getTime();
      const { data: completedJob, error: completeError } = await supabase
        .from('ai_jobs')
        .update({
          status: 'completed',
          output,
          error: null,
          next_run_at: completedAt,
          completed_at: completedAt,
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
          metadata: {
            ...asMetadataRecord(claimedJob.metadata),
            workerId,
            durationMs,
            queueWaitMs,
            model: getOllamaStorefrontModel(),
            completedAt,
          },
        })
        .eq('id', claimedJob.id)
        .eq('locked_by', workerId)
        .select('id')
        .maybeSingle();

      if (completeError) {
        throw new StorefrontJobPersistenceError(
          `Failed to persist completed storefront job ${claimedJob.id}: ${completeError.message}`
        );
      }

      if (!completedJob) {
        throw new StorefrontJobPersistenceError(
          `Failed to persist completed storefront job ${claimedJob.id}: active lease was lost`
        );
      }

      processed += 1;
    } catch (error) {
      if (error instanceof StorefrontJobPersistenceError) {
        logStorefrontJobPersistenceError(error, claimedJob.id);
        continue;
      }

      const attempts = claimedJob.attempts ?? 1;
      const maxAttempts = claimedJob.max_attempts ?? 3;
      const shouldRetry = attempts < maxAttempts;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      const { data: failedJob, error: failError } = await supabase
        .from('ai_jobs')
        .update({
          status: shouldRetry ? 'pending' : 'failed',
          attempts,
          error: errorMessage,
          next_run_at: shouldRetry
            ? new Date(Date.now() + getRetryDelayMs(attempts)).toISOString()
            : null,
          completed_at: shouldRetry ? null : new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
          metadata: {
            ...asMetadataRecord(claimedJob.metadata),
            workerId,
            durationMs: Date.now() - claimStartedAt,
            attempts,
            failedAt: new Date().toISOString(),
            validationOrGenerationError: errorMessage,
          },
        })
        .eq('id', claimedJob.id)
        .eq('locked_by', workerId)
        .select('id')
        .maybeSingle();

      if (failError) {
        logStorefrontJobPersistenceError(
          new StorefrontJobPersistenceError(
            `Failed to persist failed storefront job ${claimedJob.id}: ${failError.message}`
          ),
          claimedJob.id
        );
        continue;
      }

      if (!failedJob) {
        logStorefrontJobPersistenceError(
          new StorefrontJobPersistenceError(
            `Failed to persist failed storefront job ${claimedJob.id}: active lease was lost`
          ),
          claimedJob.id
        );
        continue;
      }

      processed += 1;
    }
  }

  return processed;
}

export async function runProcessAiStorefrontJobsCli(): Promise<number> {
  const processed = await processAiStorefrontJobs({
    supabase: createWorkerClient(),
  });
  console.log(JSON.stringify({ processed }));
  return 0;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (entrypoint && import.meta.url === entrypoint) {
  runProcessAiStorefrontJobsCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
