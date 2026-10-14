import { flushRetiredCartDevice } from './retire-device';

it('retains the tombstone on response loss and acknowledges only confirmed revocation', async () => {
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue('cp1.old.signature'),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest.fn().mockRejectedValue(new Error('offline'));
  const config = {
    apiOrigin: 'https://shop.test',
    merchantSlug: 'shop',
    merchantId: 'merchant',
  };
  await expect(
    flushRetiredCartDevice(config, storage as never, fetcher)
  ).rejects.toThrow();
  expect(storage.acknowledgeRetirement).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }), { status: 200 })
  );
  await flushRetiredCartDevice(config, storage as never, fetcher);
  expect(storage.acknowledgeRetirement).toHaveBeenCalledWith(
    'merchant',
    'cp1.old.signature'
  );
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
    'Bearer cp1.old.signature'
  );
});
