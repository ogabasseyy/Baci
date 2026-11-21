import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveBrilStashFeedDeployment } from './resolve-feed-deployment';

const host = 'feed.example.invalid';
beforeEach(() => {
  vi.stubEnv('BRILSTASH_FEED_HOST', host);
  vi.stubEnv('BRILSTASH_SUPABASE_PROJECT_REF', 'pilotref');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://pilotref.supabase.co');
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ['live', 'production', { host, singlePageOnly: true }],
  ['sandbox', 'preview', { host, singlePageOnly: false }],
  ['live', 'preview', null],
  ['sandbox', 'production', null],
])('binds %s to the %s deployment', (environment, deployment, expected) => {
  vi.stubEnv('BRILSTASH_FEED_ENV', environment);
  vi.stubEnv('VERCEL_ENV', deployment);
  expect(resolveBrilStashFeedDeployment()).toEqual(expected);
});

it('rejects a Supabase project mismatch', () => {
  vi.stubEnv('BRILSTASH_FEED_ENV', 'sandbox');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://anotherref.supabase.co');
  expect(resolveBrilStashFeedDeployment()).toBeNull();
});

it.each([
  '-',
  '.',
  '..',
  '-.-',
  '-feed.example.com',
  'feed.example.com.',
  '127.0.0.1',
  'feed..example.com',
])('rejects an invalid bare DNS hostname %s', (invalidHost) => {
  vi.stubEnv('BRILSTASH_FEED_ENV', 'sandbox');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('BRILSTASH_FEED_HOST', invalidHost);
  expect(resolveBrilStashFeedDeployment()).toBeNull();
});
