import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createGoalPolicyStore } from './goal-policy-store';

const configuration = {
  environment: 'staging',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
};
const command = {
  revisionId: '70000000-0000-4000-8000-000000000001',
  expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
  productId: '50000000-0000-4000-8000-000000000001',
  variantId: '60000000-0000-4000-8000-000000000001',
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  quoteId: 'synthetic-quote',
  quoteKobo: 100000,
  quoteExpiresAt: '2099-01-01T00:00:00Z',
  guarantee: null,
  lifecycle: 'draft',
  collectionPaused: true,
};
describe('private goal policy store', () => {
  it('routes exact duration acceptance through lifecycle without a generic receipt', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            revisionId: command.revisionId,
            durationMonths: 1,
            outcome: 'accepted',
          },
        },
      ],
    });
    const store = createGoalPolicyStore({ configuration, execute });
    await expect(
      store.accept({
        revisionId: command.revisionId,
        actorId: configuration.customerId,
        durationMonths: 1,
      })
    ).resolves.toEqual({ revisionId: command.revisionId, outcome: 'accepted' });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('accept_lifecycle_terms'),
      [
        configuration.integrationId,
        configuration.merchantId,
        configuration.customerId,
        configuration.goalId,
        configuration.expectedBusinessId,
        command.revisionId,
        configuration.customerId,
        1,
      ]
    );
  });
  it.each([
    undefined,
    2,
  ])('rejects missing or changed duration acknowledgement %s without retry', async (durationMonths) => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          result: {
            revisionId: command.revisionId,
            durationMonths,
            outcome: 'accepted',
          },
        },
      ],
    });
    await expect(
      createGoalPolicyStore({ configuration, execute }).accept({
        revisionId: command.revisionId,
        actorId: configuration.customerId,
        durationMonths: 1,
      })
    ).rejects.toThrow('Goal policy storage unavailable');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('canonicalizes uppercase UUIDs before stage and acceptance comparisons', async () => {
    const revisionId = 'abcdefab-0000-4000-8000-000000000001';
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ result: { revisionId, outcome: 'staged' } }],
      })
      .mockResolvedValueOnce({
        rows: [{ result: { revisionId, outcome: 'accepted' } }],
      });
    const store = createGoalPolicyStore({ configuration, execute });
    await expect(
      store.stage({ ...command, revisionId: revisionId.toUpperCase() })
    ).resolves.toEqual({ revisionId, outcome: 'staged' });
    await expect(
      store.accept({
        revisionId: revisionId.toUpperCase(),
        actorId: configuration.customerId,
      })
    ).resolves.toEqual({ revisionId, outcome: 'accepted' });
    expect(execute.mock.calls[1][1][5]).toBe(revisionId);
  });
  it('stages only an explicit versioned command through exact scoped parameters', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { revisionId: command.revisionId, outcome: 'staged' } }],
    });
    expect(
      await createGoalPolicyStore({ configuration, execute }).stage(command)
    ).toEqual({ revisionId: command.revisionId, outcome: 'staged' });
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.merchantId,
      configuration.customerId,
      configuration.goalId,
      configuration.expectedBusinessId,
      JSON.stringify(command),
    ]);
  });
  it('records actor and revision without taking client timestamps or legacy terms', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { result: { revisionId: command.revisionId, outcome: 'accepted' } },
      ],
    });
    const acceptance = {
      revisionId: command.revisionId,
      actorId: '90000000-0000-4000-8000-000000000001',
    };
    expect(
      await createGoalPolicyStore({ configuration, execute }).accept(acceptance)
    ).toEqual({ revisionId: command.revisionId, outcome: 'accepted' });
    expect(execute.mock.calls[0][1].slice(5)).toEqual([
      acceptance.revisionId,
      acceptance.actorId,
    ]);
  });
  it('rejects implicit guarantees, lifecycle activation and fractional kobo before storage', async () => {
    const execute = vi.fn();
    const store = createGoalPolicyStore({ configuration, execute });
    for (const change of [
      { guarantee: undefined },
      { lifecycle: 'active' },
      { quoteKobo: 1.5 },
      { termsHash: '' },
      { metadata: { accepted: true } },
    ]) {
      await expect(store.stage({ ...command, ...change })).rejects.toThrow();
    }
    await expect(
      store.accept({
        revisionId: command.revisionId,
        actorId: configuration.customerId,
        acceptedAt: '2020-01-01',
      })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('redacts failures and never replays an uncertain COMMIT', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('private detail'));
    await expect(
      createGoalPolicyStore({ configuration, execute }).stage(command)
    ).rejects.toThrow(/^Goal policy storage unavailable$/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched revision responses', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { result: { revisionId: configuration.goalId, outcome: 'staged' } },
      ],
    });
    await expect(
      createGoalPolicyStore({ configuration, execute }).stage(command)
    ).rejects.toThrow();
  });
  it('returns absent snapshots without inventing policy or acceptance', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: null }] });
    expect(
      await createGoalPolicyStore({ configuration, execute }).read()
    ).toBeNull();
  });
  it('returns persisted policy and receipt without converting snapshot price into a guarantee', async () => {
    const result = {
      revisionId: command.revisionId,
      command,
      device: {
        name: 'Synthetic phone',
        condition: 'new',
        variantId: command.variantId,
        variantLabel: '256GB',
        selectionStatus: 'exact',
        price: 123,
      },
      actorId: null,
      acceptedAt: null,
    };
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    const read = await createGoalPolicyStore({ configuration, execute }).read();
    expect(read).toMatchObject({
      command: { guarantee: null, quoteKobo: 100000 },
      acceptedAt: null,
    });
    expect(read?.device).not.toHaveProperty('price');
  });
});
