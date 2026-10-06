import { expect, it, vi } from 'vitest';
import { deviceChangeFixture } from '../test-fixtures/piggyvest-device-change';
import { createPiggyvestDeviceChangeClient } from './piggyvest-device-change-client';

it('uses exact endpoints and refuses client price before HTTP', async () => {
  const fixture = deviceChangeFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json(
      String(url).includes('/quote')
        ? fixture.published
        : String(url).includes('/confirm')
          ? fixture.receipt
          : fixture.historical
    );
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const client = createPiggyvestDeviceChangeClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/device-change',
    },
    goalId: fixture.command.goalId,
    fetch,
    getCsrfToken: async () => 'synthetic',
    isCurrent: () => true,
  });
  await expect(
    client.quote({ ...fixture.selection, priceKobo: 1 })
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await client.quote(fixture.selection)).toEqual(fixture.published);
  expect(await client.confirm(fixture.command)).toEqual(fixture.receipt);
  expect(
    await client.status({
      goalId: fixture.command.goalId,
      operationId: fixture.command.operationId,
    })
  ).toEqual(fixture.historical);
  expect(fetch).toHaveBeenCalledTimes(3);
  client.setViewGuard(() => false);
  await expect(client.confirm(fixture.command)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});
