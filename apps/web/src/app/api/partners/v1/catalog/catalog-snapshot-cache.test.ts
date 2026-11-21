import { Redis } from '@upstash/redis';
import { afterEach, expect, it, vi } from 'vitest';
import { bodyEtag, createSnapshotCache } from './catalog-snapshot-cache';

const getRedis = vi.hoisted(() => vi.fn());
vi.mock('@/lib/redis', () => ({ getRedis }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  getRedis.mockReset();
});

it('round-trips the CrossRem snapshot through the installed Upstash client', async () => {
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'crossrem-redis-contract');
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  getRedis.mockReturnValue(
    new Redis({
      url: 'https://cache.example.test',
      token: 'synthetic-test-token',
      enableAutoPipelining: false,
    })
  );
  const cache = createSnapshotCache();
  expect(cache).not.toBeNull();
  if (!cache) throw new Error('Missing fixture cache');

  const body = '{"schema_version":1,"listings":[{"listing_id":"synthetic"}]}';
  const etag = bodyEtag(body);
  const version = 'synthetic-revision';
  const encoded = (value: string) => Buffer.from(value).toString('base64');
  const requests: string[][] = [];
  let savedMetadata = '';
  let savedBody = '';
  request.mockImplementation(async (_url, options) => {
    const command: string[] = JSON.parse(String(options?.body));
    requests.push(command);
    expect(new Headers(options?.headers).get('upstash-encoding')).toBe(
      'base64'
    );

    if (command[0] === 'set') {
      const acquired = requests.filter(([name]) => name === 'set').length === 1;
      return Response.json({ result: acquired ? encoded('OK') : null });
    }
    if (command[0] === 'eval') {
      const [, , keyCount, , , , , metadata, payload] = command;
      expect(Number(keyCount)).toBe(3);
      savedMetadata = metadata;
      savedBody = payload;
      return Response.json({ result: 1 });
    }
    if (command[0] === 'get') {
      const value = command[1].endsWith(':etag') ? savedMetadata : savedBody;
      return Response.json({ result: encoded(value) });
    }
    throw new Error('Unexpected Redis command');
  });

  const lease = await cache.acquire();
  expect(lease.status).toBe('acquired');
  if (lease.status !== 'acquired') throw new Error('Missing fixture lease');
  expect(await cache.acquire()).toEqual({ status: 'busy' });
  expect(requests[0]).toEqual([
    'set',
    expect.stringMatching(/:lease$/),
    lease.token,
    'nx',
    'ex',
    75,
  ]);

  expect(await cache.publish(lease.token, version, etag, body)).toBe(true);
  expect(JSON.parse(savedMetadata)).toEqual({
    version,
    etag,
    bodyCached: true,
  });
  expect(await cache.read(version, etag)).toEqual({ etag, body: null });
  expect(requests.filter(([, key]) => key?.endsWith(':body'))).toHaveLength(0);
  expect(await cache.read(version, null)).toEqual({ etag, body });
});
