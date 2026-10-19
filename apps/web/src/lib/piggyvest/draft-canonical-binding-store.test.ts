import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createDraftCanonicalBindingStore } from './draft-canonical-binding-store';

const identity = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
  actorId: '90000000-0000-4000-8000-000000000001',
};
const configuration = {
  ...identity,
  transport: 'local_test',
  database: 'piggyvest_local',
  role: 'piggyvest_staging_policy_writer',
};
const input = {
  draftId: 'a0000000-0000-4000-8000-000000000001',
  draftRevisionId: 'a0000000-0000-4000-8000-000000000002',
  policyRevisionId: '70000000-0000-4000-8000-000000000001',
};
const receipt = {
  ...input,
  goalId: identity.goalId,
  outcome: 'bound',
  boundAt: '2026-09-13T00:00:00Z',
};

describe('draft canonical binding store', () => {
  it('returns the persisted receipt after a response-loss retry without inventing consent', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue({ rows: [{ result: receipt }] });
    const store = createDraftCanonicalBindingStore({ configuration, execute });
    await expect(store.bind(input)).rejects.toThrow(
      'Draft binding unavailable'
    );
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(store.bind(input)).resolves.toEqual(receipt);
    expect(execute.mock.calls[0]).toEqual(execute.mock.calls[1]);
    expect(execute.mock.calls[1][1]).toEqual([
      ...Object.values(identity),
      ...Object.values(input),
    ]);
  });

  it.each([
    { database: 'postgres' },
    { transport: 'tls' },
    { role: 'service_role' },
    { role: 'authenticated' },
    { actorId: '' },
    { providerWalletId: 'not-allowed' },
  ])('rejects an unsupported execution boundary before executing: %j', (override) => {
    const execute = vi.fn();
    expect(() =>
      createDraftCanonicalBindingStore({
        configuration: { ...configuration, ...override },
        execute,
      })
    ).toThrow('Draft binding unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, actorId: identity.actorId },
    { ...input, quoteKobo: 1 },
    { ...input, draftId: null },
    { ...input, accepted: true },
  ])('rejects untrusted authority and malformed selection: %j', async (selection) => {
    const execute = vi.fn();
    const store = createDraftCanonicalBindingStore({ configuration, execute });
    await expect(store.bind(selection)).rejects.toThrow(
      'Draft binding unavailable'
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...receipt, goalId: identity.customerId },
    { ...receipt, draftId: identity.customerId },
    { ...receipt, draftRevisionId: identity.customerId },
    { ...receipt, policyRevisionId: identity.customerId },
    { ...receipt, outcome: 'active' },
    { ...receipt, funding: 'allowed' },
  ])('rejects mismatched or overprivileged receipts: %j', async (result) => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    await expect(
      createDraftCanonicalBindingStore({ configuration, execute }).bind(input)
    ).rejects.toThrow('Draft binding unavailable');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
