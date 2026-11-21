import { afterEach, expect, it, vi } from 'vitest';
import { readPilotPetrockOffer } from './pilot-petrock-offer';

const getAccount = vi.hoisted(() => vi.fn());
vi.mock('../imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: () => ({ getAccount }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each([
  [10.28, 20, true, []],
  ['10.28000', 20, true, []],
  ['10.28001', 20, false, []],
  ['10.28', 10, false, []],
  ['10.28', 20, false, [{ name: 'Email', type: 'text', required: true }]],
])('checks price %s and balance %s before placement', async (price, balance, allowed, otherFields) => {
  getAccount.mockResolvedValue({
    ok: true,
    data: { currency: 'USD', balance },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          currency: 'USD',
          product: {
            name: 'PlayStation Gift Card [PSN] USA $10',
            price,
            fields: [
              { name: 'Quantity', type: 'quantity', required: true },
              ...otherFields,
            ],
          },
        },
      })
    )
  );
  await expect(
    readPilotPetrockOffer(10.28, 'https://api.petrock.biz', 'test-token')
  ).resolves.toBe(allowed);
});
