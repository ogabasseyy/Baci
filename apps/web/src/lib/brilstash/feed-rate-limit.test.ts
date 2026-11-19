import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { BRILSTASH_FEED_PATH } from '@/config/brilstash-feed';
import { getRedis } from '../redis';
import { checkBrilStashFeedRateLimit } from './feed-rate-limit';

vi.mock('../redis', () => ({ getRedis: vi.fn(() => null) }));

it('rejects a live request without a trusted IP before spending the shared budget', async () => {
  const request = new NextRequest(
    `https://feed.example.invalid${BRILSTASH_FEED_PATH}`,
    {
      headers: { 'x-forwarded-for': '192.0.2.10' },
    }
  );

  await expect(
    checkBrilStashFeedRateLimit(request, 'read')
  ).resolves.toMatchObject({
    allowed: false,
    limit: 30,
    failureReason: 'trusted_client_ip_missing',
  });
  expect(getRedis).not.toHaveBeenCalled();
});

it('preserves the shared Redis budget when trusted client identity is missing in sandbox', async () => {
  const request = new NextRequest(
    `https://sandbox-feed.example.invalid${BRILSTASH_FEED_PATH}`
  );
  await expect(
    checkBrilStashFeedRateLimit(request, 'malformed')
  ).resolves.toMatchObject({
    allowed: false,
    limit: 15,
    failureReason: 'trusted_client_ip_missing',
  });
  expect(getRedis).not.toHaveBeenCalled();
});

it('reports a shared Redis outage for a trusted client', async () => {
  vi.stubEnv('VERCEL', '1');
  try {
    const request = new NextRequest(
      `https://feed.example.invalid${BRILSTASH_FEED_PATH}`,
      { headers: { 'x-real-ip': '203.0.113.5' } }
    );
    await expect(
      checkBrilStashFeedRateLimit(request, 'read')
    ).resolves.toMatchObject({
      allowed: false,
      failureReason: 'distributed_limiter_unavailable',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
