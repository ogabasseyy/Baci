import { createCartCommandCoordinator } from './command-coordinator';
import type { PendingCartRequest } from './pending-request';
import { NativeCartError } from './shared-cart-client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const input = {
  operationId: 'same-key',
  expectedVersion: 1,
  command: { type: 'clear' as const },
};
const cartId = '22222222-2222-4222-8222-222222222222';
const merchantId = '11111111-1111-4111-8111-111111111111';
function setup() {
  let pending: PendingCartRequest | null = null;
  let actor = 'guest-a';
  const receipts = {
    read: jest.fn(async () => pending),
    save: jest.fn(async (_merchant: string, value: PendingCartRequest) => {
      if (pending) throw new Error('pending');
      pending = value;
    }),
    clear: jest.fn(async () => {
      pending = null;
    }),
  };
  const cart = {
    cartId,
    merchantId,
    version: 2,
    state: 'active' as const,
    currency: 'NGN',
    lines: [],
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const client = {
    create: jest.fn().mockResolvedValue({ cart }),
    command: jest.fn().mockResolvedValue({ cart }),
  };
  const onSnapshot = jest.fn();
  const options = {
    merchantId,
    client,
    receipts,
    getActor: async () => actor,
    isCurrent: () => true,
    onSnapshot,
  };
  return {
    receipts,
    client,
    onSnapshot,
    options,
    actor: (value: string) => {
      actor = value;
    },
  };
}
it('persists before transmission and replays the identical request after process restart', async () => {
  const s = setup();
  s.client.command.mockRejectedValueOnce(
    new NativeCartError('temporarily_unavailable', true)
  );
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toThrow();
  expect(s.receipts.save.mock.invocationCallOrder[0]).toBeLessThan(
    s.client.command.mock.invocationCallOrder[0]
  );
  expect(s.receipts.clear).not.toHaveBeenCalled();
  await createCartCommandCoordinator(s.options).recover();
  expect(s.client.command).toHaveBeenNthCalledWith(1, input, cartId);
  expect(s.client.command).toHaveBeenNthCalledWith(2, input, cartId);
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'same-key');
  expect(s.onSnapshot).toHaveBeenCalledTimes(1);
});
it.each([
  'expired',
  'unauthorized',
  'not_found',
  'merchant_unavailable',
  'idempotency_conflict',
])('releases the command receipt after a definitive %s rejection', async (code) => {
  const s = setup();
  s.client.command.mockRejectedValue(new NativeCartError(code));
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toMatchObject({ code });
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'same-key');
});
it('retains the command receipt after a transient server rejection', async () => {
  const s = setup();
  s.client.command.mockRejectedValue(
    new NativeCartError('temporarily_unavailable')
  );
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  expect(s.receipts.clear).not.toHaveBeenCalled();
});
it('never replays a previous guest intent under a new principal', async () => {
  const s = setup();
  s.client.command.mockRejectedValueOnce(
    new NativeCartError('temporarily_unavailable', true)
  );
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toThrow();
  s.actor('guest-b');
  await expect(
    createCartCommandCoordinator(s.options).recover()
  ).rejects.toMatchObject({ code: 'session_changed' });
  expect(s.client.command).toHaveBeenCalledTimes(1);
  expect(s.receipts.clear).not.toHaveBeenCalled();
});
it('keeps later edits behind an unresolved mutation instead of replacing its key', async () => {
  const s = setup();
  s.client.command.mockRejectedValue(
    new NativeCartError('temporarily_unavailable', true)
  );
  const coordinator = createCartCommandCoordinator(s.options);
  await expect(coordinator.command(cartId, input)).rejects.toThrow();
  await expect(
    coordinator.command(cartId, { ...input, operationId: 'second' })
  ).rejects.toMatchObject({ code: 'pending_operation' });
  expect(s.client.command).toHaveBeenCalledTimes(1);
});
it('does not transmit when durable persistence fails', async () => {
  const s = setup();
  s.receipts.save.mockRejectedValueOnce(new Error('storage failed'));
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toThrow();
  expect(s.client.command).not.toHaveBeenCalled();
});
it('does not publish a late snapshot after generation changes', async () => {
  const s = setup();
  let current = true;
  s.client.command.mockImplementationOnce(async () => {
    current = false;
    return { cart: {} };
  });
  await expect(
    createCartCommandCoordinator({
      ...s.options,
      isCurrent: () => current,
    }).command(cartId, input)
  ).rejects.toMatchObject({ code: 'session_changed' });
  expect(s.onSnapshot).not.toHaveBeenCalled();
  expect(s.receipts.clear).not.toHaveBeenCalled();
});
it('reconciles a creation whose proof was saved before the pending receipt was cleared', async () => {
  const s = setup();
  const receipt = {
    actor: 'guest-a',
    operationId: 'create-one',
    body: { kind: 'create', input: { operationId: 'create-one' } },
  };
  s.receipts.read.mockResolvedValue(receipt);
  const recovered = { cart: { cartId, merchantId, version: 1 } };
  const recoverCreation = jest.fn().mockResolvedValue(recovered);
  await createCartCommandCoordinator({
    ...s.options,
    client: { ...s.client, recoverCreation },
  }).recover();
  expect(recoverCreation).toHaveBeenCalledWith('create-one');
  expect(s.client.create).not.toHaveBeenCalled();
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'create-one');
});
it('recovers a persisted native pairing attempt with its exact attempt id and secret', async () => {
  const s = setup();
  const input = {
    token: 'ch1.payload.signature',
    handoffId: cartId,
    attemptId: 'pair-one',
    choice: 'connect',
  };
  s.receipts.read.mockResolvedValue({
    actor: 'guest-a',
    operationId: 'pair-one',
    body: { kind: 'handoff', input },
  });
  const redeem = jest
    .fn()
    .mockResolvedValue({ cart: { merchantId, cartId, version: 1 } });
  await createCartCommandCoordinator({
    ...s.options,
    client: { ...s.client, redeem },
  }).recover();
  expect(redeem).toHaveBeenCalledWith(input);
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'pair-one');
});
it('releases a definitively rejected command key while retaining indeterminate outcomes', async () => {
  const s = setup();
  s.client.command.mockRejectedValueOnce(
    new NativeCartError('version_conflict')
  );
  await expect(
    createCartCommandCoordinator(s.options).command(cartId, input)
  ).rejects.toMatchObject({ code: 'version_conflict' });
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, input.operationId);
});
it('releases a definitively rejected handoff attempt instead of replaying a dead grant', async () => {
  const s = setup();
  const redeem = jest
    .fn()
    .mockRejectedValue(new NativeCartError('handoff_consumed'));
  await expect(
    createCartCommandCoordinator({
      ...s.options,
      client: { ...s.client, redeem },
    }).redeem({
      token: 'ch1.payload.signature',
      handoffId: cartId,
      attemptId: 'pair-dead',
      choice: 'connect',
    })
  ).rejects.toMatchObject({ code: 'handoff_consumed' });
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'pair-dead');
});
it('releases a handoff attempt rejected for stale versions', async () => {
  const s = setup();
  const redeem = jest
    .fn()
    .mockRejectedValue(new NativeCartError('version_conflict'));
  await expect(
    createCartCommandCoordinator({
      ...s.options,
      client: { ...s.client, redeem },
    }).redeem({
      token: 'ch1.payload.signature',
      handoffId: cartId,
      attemptId: 'pair-stale',
      choice: 'connect',
    })
  ).rejects.toMatchObject({ code: 'version_conflict' });
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'pair-stale');
});
it('retains a handoff attempt whose outcome is uncertain', async () => {
  const s = setup();
  const redeem = jest
    .fn()
    .mockRejectedValue(new NativeCartError('temporarily_unavailable', true));
  await expect(
    createCartCommandCoordinator({
      ...s.options,
      client: { ...s.client, redeem },
    }).redeem({
      token: 'ch1.payload.signature',
      handoffId: cartId,
      attemptId: 'pair-uncertain',
      choice: 'connect',
    })
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  expect(s.receipts.clear).not.toHaveBeenCalled();
});
it('releases a definitively rejected creation but retains a rate-limited one', async () => {
  const s = setup();
  s.client.create.mockRejectedValueOnce(new NativeCartError('invalid_item'));
  await expect(
    createCartCommandCoordinator(s.options).create({
      operationId: 'create-bad',
    })
  ).rejects.toMatchObject({ code: 'invalid_item' });
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'create-bad');
  const s2 = setup();
  s2.client.create.mockRejectedValueOnce(new NativeCartError('rate_limited'));
  await expect(
    createCartCommandCoordinator(s2.options).create({
      operationId: 'create-later',
    })
  ).rejects.toMatchObject({ code: 'rate_limited' });
  expect(s2.receipts.clear).not.toHaveBeenCalled();
});
it('acknowledges an account principal rotation only through its owner-bound promotion receipt', async () => {
  const s = setup();
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  const cart = {
    merchantId,
    cartId,
    version: 3,
    state: 'active' as const,
    currency: 'NGN',
    lines: [],
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const linkAccount = jest.fn(async () => {
    s.actor('customer-device:rotated');
    return { cart };
  });
  const recoverAccountLink = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ cart });
  const coordinator = createCartCommandCoordinator({
    ...s.options,
    getOwnerSubject: () => ownerSubject,
    client: { ...s.client, linkAccount, recoverAccountLink },
  });
  await expect(
    coordinator.linkAccount({
      operationId: 'account-one',
      choice: 'keep_current',
    })
  ).resolves.toEqual(cart);
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'account-one');
  expect(s.receipts.save).toHaveBeenCalledWith(
    merchantId,
    expect.objectContaining({ body: expect.objectContaining({ ownerSubject }) })
  );
  expect(recoverAccountLink).toHaveBeenCalledWith(
    'account-one',
    ownerSubject,
    'guest-a'
  );
});
it('recovers a saved account promotion after restart without replaying the mutation', async () => {
  const s = setup();
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  s.receipts.read.mockResolvedValue({
    actor: 'guest-a',
    operationId: 'account-one',
    body: {
      kind: 'account',
      ownerSubject,
      input: { operationId: 'account-one', choice: 'keep_current' },
    },
  });
  s.actor('customer-device:rotated');
  const recoverAccountLink = jest
    .fn()
    .mockResolvedValue({ cart: { merchantId, cartId, version: 3 } });
  const linkAccount = jest.fn();
  await createCartCommandCoordinator({
    ...s.options,
    getOwnerSubject: () => ownerSubject,
    client: { ...s.client, linkAccount, recoverAccountLink },
  }).recover();
  expect(linkAccount).not.toHaveBeenCalled();
  expect(s.receipts.clear).toHaveBeenCalled();
});
it('never recovers an account request under a different authenticated shopper', async () => {
  const s = setup();
  s.receipts.read.mockResolvedValue({
    actor: 'guest-a',
    operationId: 'account-one',
    body: {
      kind: 'account',
      ownerSubject: '44444444-4444-4444-8444-444444444444',
      input: { operationId: 'account-one', choice: 'keep_current' },
    },
  });
  const linkAccount = jest.fn();
  const recoverAccountLink = jest.fn();
  await expect(
    createCartCommandCoordinator({
      ...s.options,
      getOwnerSubject: () => '55555555-5555-4555-8555-555555555555',
      client: { ...s.client, linkAccount, recoverAccountLink },
    }).recover()
  ).rejects.toMatchObject({ code: 'session_changed' });
  expect(linkAccount).not.toHaveBeenCalled();
  expect(recoverAccountLink).not.toHaveBeenCalled();
  expect(s.receipts.clear).not.toHaveBeenCalled();
});
it('retries the same unsettled account request without replacing its durable head', async () => {
  const s = setup();
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  let promoted = false;
  const cart = {
    merchantId,
    cartId,
    version: 3,
    state: 'active' as const,
    currency: 'NGN',
    lines: [],
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const linkAccount = jest
    .fn()
    .mockRejectedValueOnce(new NativeCartError('temporarily_unavailable', true))
    .mockImplementation(async () => {
      promoted = true;
      s.actor('customer-device:rotated');
      return { cart };
    });
  const recoverAccountLink = jest.fn(async () => (promoted ? { cart } : null));
  const coordinator = createCartCommandCoordinator({
    ...s.options,
    getOwnerSubject: () => ownerSubject,
    client: { ...s.client, linkAccount, recoverAccountLink },
  });
  const input = { operationId: 'link-one', choice: 'keep_current' as const };
  await expect(coordinator.linkAccount(input)).rejects.toThrow();
  await expect(coordinator.linkAccount(input)).resolves.toEqual(cart);
  expect(s.receipts.save).toHaveBeenCalledTimes(1);
  expect(linkAccount).toHaveBeenCalledTimes(2);
});
it.each([
  'unauthorized',
  'not_found',
  'idempotency_conflict',
  'expired',
])('releases the account receipt after a definitive %s rejection', async (code) => {
  const s = setup();
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  const linkAccount = jest.fn().mockRejectedValue(new NativeCartError(code));
  const recoverAccountLink = jest.fn(async () => null);
  const coordinator = createCartCommandCoordinator({
    ...s.options,
    getOwnerSubject: () => ownerSubject,
    client: { ...s.client, linkAccount, recoverAccountLink },
  });
  await expect(
    coordinator.linkAccount({
      operationId: 'link-definitive',
      choice: 'keep_current',
    })
  ).rejects.toThrow();
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'link-definitive');
});
it('releases the account receipt when recovery is definitively rejected', async () => {
  const s = setup();
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  const linkAccount = jest.fn();
  const recoverAccountLink = jest
    .fn()
    .mockRejectedValue(new NativeCartError('unauthorized'));
  const coordinator = createCartCommandCoordinator({
    ...s.options,
    getOwnerSubject: () => ownerSubject,
    client: { ...s.client, linkAccount, recoverAccountLink },
  });
  await expect(
    coordinator.linkAccount({
      operationId: 'link-recovery',
      choice: 'keep_current',
    })
  ).rejects.toThrow();
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'link-recovery');
  expect(linkAccount).not.toHaveBeenCalled();
});
it('commits a keep_existing handoff with no destination cart without a snapshot', async () => {
  const s = setup();
  const redeem = jest
    .fn()
    .mockResolvedValue({ cart: null, proof: 'cp1.bootstrap.signature' });
  const result = await createCartCommandCoordinator({
    ...s.options,
    client: { ...s.client, redeem },
  }).redeem({
    token: 'ch1.payload.signature',
    handoffId: cartId,
    attemptId: 'pair-keep-1',
    choice: 'keep_existing',
  });
  expect(result).toBeNull();
  expect(s.receipts.clear).toHaveBeenCalledWith(merchantId, 'pair-keep-1');
  expect(s.onSnapshot).not.toHaveBeenCalled();
});
