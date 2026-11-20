import { expect, it } from 'vitest';
import { brilStashFeedDeploymentSchema } from './brilstash-feed-deployment';

it('accepts a DNS label of up to 63 characters', () => {
  const config = {
    host: `${'a'.repeat(63)}.example.invalid`,
    environment: 'sandbox',
    projectRef: 'pilot123',
  };
  expect(brilStashFeedDeploymentSchema.parse(config)).toEqual(config);
});

it.each([
  { host: `${'a'.repeat(64)}.example.invalid` },
  { host: ' feed.example.invalid' },
  { host: 'feed.example.invalid:443' },
  { host: 'https://feed.example.invalid' },
  { projectRef: 'bad-ref' },
  { environment: 'development' },
  { extra: true },
])('rejects invalid deployment configuration %#', (override) => {
  const config = {
    host: 'feed.example.invalid',
    environment: 'live',
    projectRef: 'pilot',
    ...override,
  };
  expect(brilStashFeedDeploymentSchema.safeParse(config).success).toBe(false);
});
