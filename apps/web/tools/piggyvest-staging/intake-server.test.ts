import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createStagingIntakeServer } from './intake-server';

const secret = 'test_key_synthetic';
const config = {
  environment: 'staging',
  providerSecret: secret,
  integrationToken: 'a'.repeat(64),
  encryptionKey: Buffer.alloc(32, 1).toString('base64'),
  restToken: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'pvb_staging_ingest', exp: 4102444800 })).toString('base64url')}.c3ludGhldGlj`,
};

describe('standalone staging intake server', () => {
  it('accepts a signed synthetic request only after durable storage', async () => {
    const receipt = {
      receiptId: 'f18a0000-0000-4000-8000-000000000001',
      duplicate: false,
      durable: true,
      signatureStored: true,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(receipt));
    const server = createStagingIntakeServer(config, fetcher);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing test port');
      const body = '{"test":"synthetic"}';
      const signature = createHmac('sha512', secret).update(body).digest('hex');
      const response = await fetch(
        `http://127.0.0.1:${address.port}/piggyvest/intake`,
        {
          method: 'POST',
          body,
          headers: {
            Authorization: `Bearer ${config.integrationToken}`,
            'x-pvb-signature': signature,
          },
        }
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        received: true,
        durable: true,
        processing: 'quarantined',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fetcher.mock.calls)).not.toContain(body);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('rejects production configuration before opening a socket', () => {
    expect(() =>
      createStagingIntakeServer({ ...config, environment: 'production' })
    ).toThrow();
  });
});
