import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { encryptOxygenDraft } from './draft-crypto';
import { readOxygenResidentialDraft, saveOxygenDraft } from './draft-store';

const key = 'ab'.repeat(32);
const id = '60000000-0000-4000-8000-000000000001';
const mutation = '60000000-0000-4000-8000-000000000002';
function query(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}
function client(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const q of queries) from.mockReturnValueOnce(q);
  const rpc = vi.fn(
    async () =>
      queries[2]?.maybeSingle() ?? { data: null, error: { code: '40001' } }
  );
  return { from, rpc } as unknown as SupabaseClient;
}
const owned = () =>
  query({ id, stage: 'application_required', environment: 'staging' });
function saved() {
  return {
    version: 1,
    mutation_id: mutation,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptOxygenDraft(
      { step: 0, fields: { bvn: '12345678901' } },
      key,
      { userId: 'user', workflowId: id, version: 1 }
    ),
  };
}
beforeEach(() => vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', key));
afterEach(() => vi.unstubAllEnvs());

it('stores a separate encrypted residential-only copy for recovery after identity is purged', async () => {
  const full = {
    step: 2 as const,
    fields: {
      bvn: '12345678901',
      nin: '98765432109',
      home_street: 'Example Road',
      home_lga: 'Ikeja',
    },
  };
  const write = query({ version: 1 });
  const writer = client(owned(), query(null), write);
  await saveOxygenDraft(writer, 'user', {
    workflowId: id,
    version: 0,
    idempotencyKey: mutation,
    draft: full,
  });
  const args = vi.mocked(writer.rpc).mock.calls[0][1];
  if (!args) throw new Error('Missing RPC arguments');
  const row = {
    residential_ciphertext: args.p_residential_ciphertext as string,
    residential_version: 1,
    mutation_id: mutation,
  };
  const { decryptOxygenDraft } = await import('./draft-crypto');
  expect(
    decryptOxygenDraft(row.residential_ciphertext, key, {
      userId: 'user',
      workflowId: id,
      version: 1,
      purpose: 'residential',
    })
  ).toEqual({
    step: 0,
    fields: { home_street: 'Example Road', home_lga: 'Ikeja' },
  });
  expect(row.residential_version).toBe(1);
  expect(
    await readOxygenResidentialDraft(
      client(
        query({ id, environment: 'staging' }),
        query({
          ...row,
          ciphertext: null,
          version: 2,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
      ),
      'user',
      id
    )
  ).toMatchObject({ street: 'Example Road', lga: 'Ikeja' });
});

it('reuses only address data from a minimized source in a local staging attempt', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT', 'true');
  const { readOxygenDraftForLocalAttempt } = await import('./draft-store');
  const sourceId = '60000000-0000-4000-8000-000000000003';
  const target = {
    id,
    stage: 'application_required',
    environment: 'staging',
    merchant_id: 'merchant',
    customer_id: 'customer',
  };
  const home = { step: 0 as const, fields: { home_street: 'Example Road' } };
  const row = {
    ...saved(),
    ciphertext: null,
    version: 2,
    residential_version: 1,
    residential_ciphertext: encryptOxygenDraft(home, key, {
      userId: 'user',
      workflowId: sourceId,
      version: 1,
      purpose: 'residential',
    }),
  };
  const db = client(
    query(target),
    query(target),
    query(null),
    query({ ...target, id: sourceId }),
    query(row)
  );
  expect(
    await readOxygenDraftForLocalAttempt(db, 'user', id, sourceId)
  ).toEqual({ version: 0, draft: home });
});

it('persists through the workflow-first locking RPC instead of a direct table write', async () => {
  const db = client(owned(), query(null));
  const rpc = vi.fn().mockResolvedValue({ data: { version: 1 }, error: null });
  Object.assign(db, { rpc });
  await saveOxygenDraft(db, 'user', {
    workflowId: id,
    version: 0,
    idempotencyKey: mutation,
    draft: { step: 0, fields: { bvn: '12345678901' } },
  });
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_save_form_draft',
    expect.objectContaining({ p_workflow_id: id, p_expected_version: 0 })
  );
});
