import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { encryptOxygenDraft } from './draft-crypto';
import { readOxygenDraft, saveOxygenDraft } from './draft-store';

const key = 'ab'.repeat(32);
const id = '60000000-0000-4000-8000-000000000001';
const mutation = '60000000-0000-4000-8000-000000000002';
const draft = { step: 0 as const, fields: { bvn: '12345678901' } };
function query(data: unknown, error: { code: string } | null = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}
function client(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const q of queries) from.mockReturnValueOnce(q);
  return { from } as unknown as SupabaseClient;
}
const owned = () =>
  query({ id, stage: 'application_required', environment: 'staging' });
function saved(version = 1) {
  return {
    version,
    mutation_id: mutation,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptOxygenDraft(draft, key, {
      userId: 'user',
      workflowId: id,
      version,
    }),
  };
}
beforeEach(() => vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', key));
it('refuses invisible workflows before reading drafts', async () => {
  const db = client(query(null));
  await expect(readOxygenDraft(db, 'user', id)).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(db.from).toHaveBeenCalledTimes(1);
});
it('refuses production or progressed workflows', async () => {
  await expect(
    saveOxygenDraft(
      client(query({ stage: 'booked', environment: 'staging' })),
      'user',
      { workflowId: id, version: 0, idempotencyKey: mutation, draft }
    )
  ).rejects.toMatchObject({ code: 'stage_locked' });
});
it('returns a saved encrypted draft for its authenticated context and hides expired contents', async () => {
  expect(
    await readOxygenDraft(client(owned(), query(saved())), 'user', id)
  ).toEqual({ version: 1, draft });
  expect(
    await readOxygenDraft(
      client(
        owned(),
        query({ ...saved(), expires_at: '2020-01-01T00:00:00Z' })
      ),
      'user',
      id
    )
  ).toEqual({ version: 1, draft: null });
});
it('stores ciphertext, not identifiers, and makes a lost-response replay idempotent', async () => {
  const write = query({ version: 1 });
  expect(
    await saveOxygenDraft(client(owned(), query(null), write), 'user', {
      workflowId: id,
      version: 0,
      idempotencyKey: mutation,
      draft,
    })
  ).toEqual({ version: 1 });
  const row = write.insert.mock.calls[0][0];
  expect(row.ciphertext).not.toContain('12345678901');
  expect(row).not.toHaveProperty('fields');
  const db = client(owned(), query(saved()));
  expect(
    await saveOxygenDraft(db, 'user', {
      workflowId: id,
      version: 0,
      idempotencyKey: mutation,
      draft,
    })
  ).toEqual({ version: 1 });
  expect(db.from).toHaveBeenCalledTimes(2);
});
it('rejects stale versions, reused mutation keys with changed values and concurrent writes', async () => {
  await expect(
    saveOxygenDraft(client(owned(), query(saved())), 'user', {
      workflowId: id,
      version: 0,
      idempotencyKey: crypto.randomUUID(),
      draft,
    })
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    saveOxygenDraft(client(owned(), query(saved())), 'user', {
      workflowId: id,
      version: 0,
      idempotencyKey: mutation,
      draft: { step: 1, fields: {} },
    })
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    saveOxygenDraft(client(owned(), query(saved()), query(null)), 'user', {
      workflowId: id,
      version: 1,
      idempotencyKey: crypto.randomUUID(),
      draft,
    })
  ).rejects.toMatchObject({ code: 'conflict' });
});
it('fails closed when encryption configuration or storage is unavailable', async () => {
  vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', '');
  await expect(
    readOxygenDraft(client(owned()), 'user', id)
  ).rejects.toMatchObject({ code: 'unavailable' });
});

it('reuses only an owned same-customer staging draft for an empty local test, without changing its source', async () => {
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
  const source = { ...target, id: sourceId, stage: 'reconciliation_required' };
  const row = {
    ...saved(),
    ciphertext: encryptOxygenDraft({ ...draft, step: 2 }, key, {
      userId: 'user',
      workflowId: sourceId,
      version: 1,
    }),
  };
  const sourceRow = query(row);
  const db = client(
    query(target),
    query(target),
    query(null),
    query(source),
    sourceRow
  );
  expect(
    await readOxygenDraftForLocalAttempt(db, 'user', id, sourceId)
  ).toEqual({ version: 0, draft });
  expect(sourceRow.update).not.toHaveBeenCalled();
  expect(sourceRow.insert).not.toHaveBeenCalled();
  const foreign = client(
    query(target),
    query(target),
    query(null),
    query({ ...source, customer_id: 'someone-else' })
  );
  await expect(
    readOxygenDraftForLocalAttempt(foreign, 'user', id, sourceId)
  ).rejects.toMatchObject({ code: 'not_found' });
  expect(foreign.from).toHaveBeenCalledTimes(4);
  vi.stubEnv('NODE_ENV', 'production');
  const disabled = client();
  await expect(
    readOxygenDraftForLocalAttempt(disabled, 'user', id, sourceId)
  ).rejects.toMatchObject({ code: 'stage_locked' });
  expect(disabled.from).not.toHaveBeenCalled();
});

it('does not replace existing target progress or reuse an expired source', async () => {
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
  const existing = client(query(target), query(target), query(saved()));
  expect(
    await readOxygenDraftForLocalAttempt(existing, 'user', id, sourceId)
  ).toEqual({ version: 1, draft });
  expect(existing.from).toHaveBeenCalledTimes(3);
  const expired = client(
    query(target),
    query(target),
    query(null),
    query({ ...target, id: sourceId }),
    query({ ...saved(), expires_at: '2020-01-01T00:00:00Z' })
  );
  expect(
    await readOxygenDraftForLocalAttempt(expired, 'user', id, sourceId)
  ).toEqual({ version: 0, draft: null });
});
