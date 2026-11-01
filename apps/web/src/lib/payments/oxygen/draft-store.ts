import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { oxygenDraftWriteSchema } from '@/schemas/oxygen-form-draft';
import { decryptOxygenDraft, encryptOxygenDraft } from './draft-crypto';

const rowSchema = z.object({
  ciphertext: z.string(),
  version: z.number().int().positive(),
  mutation_id: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
});
export class OxygenDraftError extends Error {
  constructor(
    public code: 'not_found' | 'conflict' | 'unavailable' | 'stage_locked'
  ) {
    super('Draft unavailable');
  }
}

function runtimeEnvironment() {
  return process.env.VERCEL_ENV === 'production' ? 'production' : 'staging';
}

function environmentEnabled(environment: unknown) {
  return (
    environment === runtimeEnvironment() &&
    (environment !== 'production' ||
      process.env.OXYGEN_PRODUCTION_RUNTIME_ENABLED === 'true')
  );
}

async function ownedWorkflow(client: SupabaseClient, workflowId: string) {
  const result = await client
    .from('oxygen_workflows')
    .select('id, stage, environment, merchant_id, customer_id')
    .eq('id', workflowId)
    .maybeSingle();
  if (result.error) throw new OxygenDraftError('unavailable');
  if (!result.data) throw new OxygenDraftError('not_found');
  if (
    !environmentEnabled(result.data.environment) ||
    result.data.stage !== 'application_required'
  )
    throw new OxygenDraftError('stage_locked');
  return result.data;
}
function getKey() {
  const key =
    (runtimeEnvironment() === 'production'
      ? process.env.OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY
      : process.env.OXYGEN_DRAFT_ENCRYPTION_KEY) ?? '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new OxygenDraftError('unavailable');
  return key;
}
async function readRow(client: SupabaseClient, workflowId: string) {
  const result = await client
    .from('oxygen_form_drafts')
    .select('ciphertext, version, mutation_id, expires_at')
    .eq('workflow_id', workflowId)
    .maybeSingle();
  if (result.error) throw new OxygenDraftError('unavailable');
  if (!result.data) return null;
  const parsed = rowSchema.safeParse(result.data);
  if (!parsed.success) throw new OxygenDraftError('unavailable');
  return parsed.data;
}

/** All clients are caller-scoped, and database RLS rechecks workflow ownership. */
export async function readOxygenDraft(
  client: SupabaseClient,
  userId: string,
  workflowId: string
) {
  await ownedWorkflow(client, workflowId);
  const key = getKey();
  const row = await readRow(client, workflowId);
  if (!row) return { draft: null, version: 0 };
  if (Date.parse(row.expires_at) <= Date.now())
    return { draft: null, version: row.version };
  const draft = decryptOxygenDraft(row.ciphertext, key, {
    userId,
    workflowId,
    version: row.version,
  });
  return { draft, version: row.version };
}

export async function saveOxygenDraft(
  client: SupabaseClient,
  userId: string,
  input: z.infer<typeof oxygenDraftWriteSchema>
) {
  await ownedWorkflow(client, input.workflowId);
  const key = getKey();
  const row = await readRow(client, input.workflowId);
  if (
    row?.mutation_id === input.idempotencyKey &&
    row.version === input.version + 1
  ) {
    const previous = decryptOxygenDraft(row.ciphertext, key, {
      userId,
      workflowId: input.workflowId,
      version: row.version,
    });
    if (JSON.stringify(previous) !== JSON.stringify(input.draft))
      throw new OxygenDraftError('conflict');
    return { version: row.version };
  }
  if ((row?.version ?? 0) !== input.version)
    throw new OxygenDraftError('conflict');
  const version = input.version + 1;
  const ciphertext = encryptOxygenDraft(input.draft, key, {
    userId,
    workflowId: input.workflowId,
    version,
  });
  const values = {
    ciphertext,
    version,
    mutation_id: input.idempotencyKey,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  };
  const result = row
    ? await client
        .from('oxygen_form_drafts')
        .update(values)
        .eq('workflow_id', input.workflowId)
        .eq('version', input.version)
        .select('version')
        .maybeSingle()
    : await client
        .from('oxygen_form_drafts')
        .insert({ ...values, workflow_id: input.workflowId, user_id: userId })
        .select('version')
        .maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data))
    throw new OxygenDraftError('conflict');
  if (result.error || !result.data) throw new OxygenDraftError('unavailable');
  return { version };
}

/** Read-only reuse for an explicitly requested local staging test. Ownership is
 * checked by RLS on both workflows; consent and verification are never copied. */
export async function readOxygenDraftForLocalAttempt(
  client: SupabaseClient,
  userId: string,
  workflowId: string,
  sourceWorkflowId: string
) {
  if (
    runtimeEnvironment() !== 'staging' ||
    process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT !== 'true'
  )
    throw new OxygenDraftError('stage_locked');
  const target = await ownedWorkflow(client, workflowId);
  const current = await readOxygenDraft(client, userId, workflowId);
  if (current.version > 0 || workflowId === sourceWorkflowId) return current;
  const source = await client
    .from('oxygen_workflows')
    .select('id, environment, merchant_id, customer_id')
    .eq('id', sourceWorkflowId)
    .maybeSingle();
  if (source.error) throw new OxygenDraftError('unavailable');
  if (
    !source.data ||
    !target.merchant_id ||
    !target.customer_id ||
    source.data.environment !== 'staging' ||
    source.data.merchant_id !== target.merchant_id ||
    source.data.customer_id !== target.customer_id
  )
    throw new OxygenDraftError('not_found');
  const row = await readRow(client, sourceWorkflowId);
  if (!row || Date.parse(row.expires_at) <= Date.now()) return current;
  const saved = decryptOxygenDraft(row.ciphertext, getKey(), {
    userId,
    workflowId: sourceWorkflowId,
    version: row.version,
  });
  return { version: 0, draft: { ...saved, step: 0 as const } };
}

/** Reuse only saved residential text after booking. RLS and authenticated encryption
 * still bind it to this user/workflow; identity fields and documents never leave here. */
export async function readOxygenResidentialDraft(
  client: SupabaseClient,
  userId: string,
  workflowId: string
): Promise<Record<string, string>> {
  const workflow = await client
    .from('oxygen_workflows')
    .select('id, environment')
    .eq('id', workflowId)
    .maybeSingle();
  if (
    workflow.error ||
    !workflow.data ||
    !environmentEnabled(workflow.data.environment)
  )
    throw new OxygenDraftError('not_found');
  const row = await readRow(client, workflowId);
  if (!row || Date.parse(row.expires_at) <= Date.now()) return {};
  const draft = decryptOxygenDraft(row.ciphertext, getKey(), {
    userId,
    workflowId,
    version: row.version,
  });
  const keys = [
    'state',
    'lga',
    'city',
    'street',
    'landmark',
    'house_number',
  ] as const;
  const address = Object.fromEntries(
    keys.map((key) => [key, draft.fields[`home_${key}`] ?? ''])
  );
  return address.street ? address : {};
}
