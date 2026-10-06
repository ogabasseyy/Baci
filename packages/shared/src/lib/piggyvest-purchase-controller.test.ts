import { expect, it, vi } from 'vitest';
import { piggyvestPurchaseSchemas as schemas } from '../contracts/piggyvest-purchase';
import { purchaseFixture } from '../test-fixtures/piggyvest-purchase';
import { createPiggyvestPurchaseController } from './piggyvest-purchase-controller';

function setup(mode: 'prepare' | 'recovery' = 'prepare') {
  const fixture = purchaseFixture();
  const client = {
    quote: vi.fn().mockResolvedValue(fixture.published),
    prepare: vi.fn().mockResolvedValue(fixture.receipt),
    status: vi.fn().mockResolvedValue(fixture.status),
  };
  const isCurrent = vi.fn(() => true);
  const controller = createPiggyvestPurchaseController({
    source: fixture.source,
    tenantKey: 'tenant',
    operationId: fixture.operationId,
    mode,
    client,
    isCurrent,
  });
  return { ...fixture, controller, client, isCurrent };
}
it('isolates pending observer exceptions without losing dispatch or later notifications', async () => {
  const test = setup();
  await test.controller.quote(test.selection);
  const broken = vi.fn(() => {
    throw new Error('observer failed');
  });
  const unsubscribeBroken = test.controller.subscribe(broken);
  const healthy = vi.fn();
  const unsubscribeHealthy = test.controller.subscribe(healthy);
  await expect(test.controller.prepare(test.command)).resolves.toEqual(
    test.receipt
  );
  expect(test.client.prepare).toHaveBeenCalledOnce();
  expect(broken).toHaveBeenCalledOnce();
  expect(healthy).toHaveBeenCalledTimes(2);
  expect(test.controller.read(test.source)?.status).toBe('prepared');
  unsubscribeBroken();
  unsubscribeHealthy();
  await test.controller.recover();
  expect(healthy).toHaveBeenCalledTimes(2);
  expect(test.controller.read(test.source)).toMatchObject({
    recovery: test.status,
  });
});
it('loads exact pickup review then prepares once with stable command and no authority', async () => {
  const test = setup();
  expect(test.controller.read(test.source)?.status).toBe('selection');
  await test.controller.quote(test.selection);
  expect(test.controller.read(test.source)).toMatchObject({
    status: 'review',
    command: test.command,
  });
  await test.controller.prepare(test.command);
  expect(test.controller.getFundingBlocked()).toBe(true);
  await expect(test.controller.prepare(test.command)).rejects.toThrow();
  expect(test.client.prepare).toHaveBeenCalledOnce();
  await test.controller.recover();
  expect(test.controller.read(test.source)).toMatchObject({
    status: 'prepared',
    recovery: test.status,
  });
});
it('blocks same-tick double submission before any response and never retries uncertainty', async () => {
  const test = setup();
  await test.controller.quote(test.selection);
  let fail: (error: Error) => void = () => undefined;
  test.client.prepare.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  const first = test.controller.prepare(test.command);
  const rejected = expect(first).rejects.toThrow();
  await expect(test.controller.prepare(test.command)).rejects.toThrow();
  fail(new Error('response lost'));
  await rejected;
  await expect(test.controller.quote(test.selection)).rejects.toThrow();
  expect(test.controller.read(test.source)).toMatchObject({
    status: 'uncertain',
  });
  expect(test.client.prepare).toHaveBeenCalledOnce();
});
it('invalidates confirmation when source revision/device changes', async () => {
  const test = setup();
  await test.controller.quote(test.selection);
  expect(
    test.controller.read({
      ...test.source,
      policy: {
        ...test.source.policy,
        device: { ...test.source.policy.device, variant: 'another' },
      },
    })
  ).toBeNull();
  await expect(test.controller.prepare(test.command)).rejects.toThrow();
  expect(test.client.prepare).not.toHaveBeenCalled();
});
it('rejects mismatched quote revision and pending-interest authority', async () => {
  const test = setup();
  test.client.quote.mockResolvedValue({
    ...test.published,
    quote: { ...test.published.quote, revisionId: test.goalId },
  });
  await expect(test.controller.quote(test.selection)).rejects.toThrow();
  expect(test.controller.read(test.source)?.status).toBe('unavailable');
});
it('does not restore cached retained evidence after a failed recovery', async () => {
  const test = setup('recovery');
  await test.controller.recover();
  test.client.status.mockRejectedValue(new Error('lost'));
  await expect(test.controller.recover()).rejects.toThrow();
  expect(test.controller.read(test.source)).toMatchObject({
    status: 'uncertain',
    recovery: null,
  });
  await expect(test.controller.quote(test.selection)).rejects.toThrow();
  expect(test.client.prepare).not.toHaveBeenCalled();
});
it('rejects recovery that replaces the original command financial breakdown', async () => {
  const test = setup();
  await test.controller.quote(test.selection);
  await test.controller.prepare(test.command);
  test.client.status.mockResolvedValue({
    ...test.status,
    quoteId: test.goalId,
  });
  await expect(test.controller.recover()).rejects.toThrow();
  expect(test.controller.read(test.source)).toMatchObject({
    receipt: test.receipt,
    recovery: null,
  });
});
it('returns isolated view copies and primitive subscription snapshots', async () => {
  const test = setup();
  const listener = vi.fn();
  const unsubscribe = test.controller.subscribe(listener);
  await test.controller.quote(test.selection);
  expect(test.controller.getSnapshot()).toBe(2);
  const view = test.controller.read(test.source);
  if (view?.status !== 'review') throw new Error('Expected review');
  view.command.quote.deviceKobo = 1;
  expect(test.controller.read(test.source)).toMatchObject({
    command: test.command,
  });
  unsubscribe();
  const calls = listener.mock.calls.length;
  test.controller.invalidate();
  expect(listener).toHaveBeenCalledTimes(calls);
});
it('rejects altered confirmation and expired quote before prepare dispatch', async () => {
  const test = setup();
  let now = 0;
  const controller = createPiggyvestPurchaseController({
    source: test.source,
    tenantKey: 'tenant',
    operationId: test.operationId,
    client: test.client,
    isCurrent: () => true,
    now: () => now,
  });
  await controller.quote(test.selection);
  await expect(
    controller.prepare({ ...test.command, accepted: false })
  ).rejects.toThrow();
  now = Date.parse(test.published.quote.expiresAt);
  await expect(
    controller.prepare(schemas.confirmation.parse(test.command))
  ).rejects.toThrow();
  expect(test.client.prepare).not.toHaveBeenCalled();
});
