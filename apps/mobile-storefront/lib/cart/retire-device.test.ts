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

it('acknowledges an offline retired proof once the server reports its revocation window expired', async () => {
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue('cp1.old.signature'),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'expired_proof', error: 'Session ended' }),
        { status: 401 }
      )
    );
  const config = {
    apiOrigin: 'https://shop.test',
    merchantSlug: 'shop',
    merchantId: 'merchant',
  };
  await expect(
    flushRetiredCartDevice(config, storage as never, fetcher)
  ).rejects.toMatchObject({ code: 'revocation_pending' });
  expect(storage.acknowledgeRetirement).not.toHaveBeenCalled();
  await expect(
    flushRetiredCartDevice(config, storage as never, fetcher)
  ).resolves.toBeUndefined();
  expect(storage.acknowledgeRetirement).toHaveBeenCalledWith(
    'merchant',
    'cp1.old.signature'
  );
});

it('acknowledges retirement on a definitive invalid_proof after key rotation', async () => {
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue('cp1.old.signature'),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: 'invalid_proof' }), { status: 401 })
    );
  await expect(
    flushRetiredCartDevice(
      {
        apiOrigin: 'https://shop.test',
        merchantSlug: 'shop',
        merchantId: 'merchant',
      },
      storage as never,
      fetcher
    )
  ).resolves.toBeUndefined();
  expect(storage.acknowledgeRetirement).toHaveBeenCalledWith(
    'merchant',
    'cp1.old.signature'
  );
});

it.each([
  [401, { code: 'unauthorized' }],
  [401, { code: 'invalid_proof', revoked: false }],
  [200, { code: 'expired_proof' }],
  [503, { code: 'expired_proof' }],
  [401, { code: 'expired_proof', revoked: false }],
  [401, null],
  [200, { revoked: 'true' }],
])('retains retirement on malformed or unauthorized response %s %j', async (status, body) => {
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue('cp1.old.signature'),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  await expect(
    flushRetiredCartDevice(
      {
        apiOrigin: 'https://shop.test',
        merchantSlug: 'shop',
        merchantId: 'merchant',
      },
      storage as never,
      fetcher
    )
  ).rejects.toMatchObject({ code: 'revocation_pending' });
  expect(storage.acknowledgeRetirement).not.toHaveBeenCalled();
});

it('keeps an unexpired proof pending while revocation is unavailable', async () => {
  const proof = `cp1.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue(proof),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
      status: 503,
    })
  );
  await expect(
    flushRetiredCartDevice(
      {
        apiOrigin: 'https://shop.test',
        merchantSlug: 'shop',
        merchantId: 'merchant',
      },
      storage as never,
      fetcher
    )
  ).rejects.toMatchObject({ code: 'revocation_pending' });
  expect(storage.acknowledgeRetirement).not.toHaveBeenCalled();
});

it('already acknowledges a successful revocation even when an extra grace timestamp is past', async () => {
  const storage = {
    getRetiredProof: jest.fn().mockResolvedValue('cp1.old.signature'),
    acknowledgeRetirement: jest.fn(),
  };
  const fetcher = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        revoked: true,
        code: 'already_revoked',
        keepProofUntil: '2000-01-01T00:00:00Z',
      }),
      { status: 200 }
    )
  );
  await flushRetiredCartDevice(
    {
      apiOrigin: 'https://shop.test',
      merchantSlug: 'shop',
      merchantId: 'merchant',
    },
    storage as never,
    fetcher
  );
  expect(storage.acknowledgeRetirement).toHaveBeenCalledWith(
    'merchant',
    'cp1.old.signature'
  );
});

it('unblocks fresh bootstrap after acknowledging an expired retired generation', async () => {
  const { createNativeCartSession } = await import('./shared-cart-session');
  const merchantId = '11111111-1111-4111-8111-111111111111';
  let retired: string | null = 'cp1.old.signature';
  const storage = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    remove: jest.fn(),
    getRetiredProof: jest.fn(async () => retired),
    acknowledgeRetirement: jest.fn(async (_merchant: string, proof: string) => {
      if (retired === proof) retired = null;
    }),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'expired_proof', error: 'Session ended' }),
        { status: 401 }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'csrf-token' }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          proof: 'cp1.fresh.signature',
          merchant: { id: merchantId, slug: 'shop' },
        })
      )
    );
  const keepProof = jest.fn();
  const session = createNativeCartSession({
    config: {
      apiOrigin: 'https://shop.test',
      merchantId,
      merchantSlug: 'shop',
    },
    merchant: merchantId,
    origin: 'https://shop.test',
    storage,
    fetcher,
    keepProof,
    assertCurrent: jest.fn(),
    read: jest.fn(),
  });
  await expect(session.bootstrap()).resolves.toEqual({
    proof: 'cp1.fresh.signature',
  });
  expect(retired).toBeNull();
  expect(keepProof).toHaveBeenCalledWith(
    { proof: 'cp1.fresh.signature' },
    false
  );
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer cp1.old.signature'
  );
  expect(fetcher.mock.calls[2][1].headers).not.toHaveProperty('Authorization');
});
