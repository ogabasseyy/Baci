import { expect, it, vi } from 'vitest';
import { purchaseFixture } from '../test-fixtures/piggyvest-purchase';
import { createPiggyvestPurchaseClient } from './piggyvest-purchase-client';

function setup() {
  const fixture = purchaseFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json(
      String(url).includes('/quote')
        ? fixture.published
        : String(url).includes('/prepare')
          ? fixture.receipt
          : fixture.status
    );
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const getCsrfToken = vi.fn(async () => 'synthetic-token');
  const client = createPiggyvestPurchaseClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/purchase',
      credentials: 'same-origin',
    },
    goalId: fixture.goalId,
    fetch,
    getCsrfToken,
    isCurrent: () => true,
  });
  return { ...fixture, client, fetch, getCsrfToken };
}
it('rechecks the live view guard after deferred CSRF before dispatch', async () => {
  const test = setup();
  let release: (token: string) => void = () => undefined;
  test.getCsrfToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  let active = true;
  test.client.setViewGuard(() => active);
  const pending = test.client.prepare(test.command);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(test.getCsrfToken).toHaveBeenCalledOnce());
  active = false;
  release('synthetic-token');
  await rejected;
  expect(test.fetch).not.toHaveBeenCalled();
});
it('uses fixed purchase routes, bounded transport, CSRF and exact command bytes', async () => {
  const test = setup();
  expect(await test.client.quote(test.selection)).toEqual(test.published);
  expect(await test.client.prepare(test.command)).toEqual(test.receipt);
  expect(
    await test.client.status({
      goalId: test.goalId,
      operationId: test.operationId,
    })
  ).toEqual(test.status);
  expect(test.getCsrfToken).toHaveBeenCalledTimes(2);
  expect(test.fetch.mock.calls[1][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
    credentials: 'same-origin',
    body: JSON.stringify(test.command),
  });
});
it('rejects actor, price, mode and cross-goal input before any transport', async () => {
  const test = setup();
  for (const patch of [
    { actorId: test.goalId },
    { price: 1 },
    { fulfilmentMode: 'ship' },
    { goalId: test.operationId },
  ])
    await expect(
      test.client.quote({ ...test.selection, ...patch })
    ).rejects.toThrow();
  expect(test.fetch).not.toHaveBeenCalled();
  expect(test.getCsrfToken).not.toHaveBeenCalled();
});
it('rejects mismatched receipt and never retries an uncertain response', async () => {
  const test = setup();
  test.fetch.mockImplementation(async (url) => {
    const response = Response.json({
      ...test.receipt,
      operationId: test.goalId,
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  await expect(test.client.prepare(test.command)).rejects.toThrow(
    'Purchase unavailable'
  );
  expect(test.fetch).toHaveBeenCalledOnce();
});
it('requires current evidence for status instead of accepting historical success', async () => {
  const test = setup();
  test.fetch.mockImplementation(async (url) => {
    const response = Response.json(test.receipt);
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  await expect(
    test.client.status({ goalId: test.goalId, operationId: test.operationId })
  ).rejects.toThrow();
});
