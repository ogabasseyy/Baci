import { expect, it } from 'vitest';
import { primaryReadinessFixture } from '@/lib/piggyvest/primary-restricted-readiness.test-support';
import { primaryRestrictedReadinessSchema as schema } from './primary-restricted-readiness';

it('accepts only bounded metadata with complete role and route observations', () => {
  expect(schema.safeParse(primaryReadinessFixture()).success).toBe(true);
});
it.each([
  { requestBodySent: true },
  { providerCalls: 1 },
  { databaseWrites: 1 },
  { authentication: 'authenticated' },
  { password: 'do-not-echo' },
])('rejects credential-bearing or potentially mutating route evidence', (change) => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture.routes[0], change);
  expect(schema.safeParse(fixture).success).toBe(false);
});
it.each([
  'not-a-url',
  'http://app.example.com',
  'https://user:password@app.example.com',
  'https://app.example.com/path',
  'https://app.example.com?token=private',
])('rejects unsafe application origins %s', (applicationOrigin) => {
  const fixture = primaryReadinessFixture();
  fixture.configuration.applicationOrigin = applicationOrigin;
  expect(schema.safeParse(fixture).success).toBe(false);
});
it('rejects raw secrets in nested configuration and role snapshots', () => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture.configuration, { providerToken: 'do-not-echo' });
  expect(schema.safeParse(fixture).success).toBe(false);
  const second = primaryReadinessFixture();
  Object.assign(second.roles[0], { password: 'do-not-echo' });
  expect(schema.safeParse(second).success).toBe(false);
});
it('rejects invalid dates, database endpoints and unbounded inventory arrays', () => {
  const fixture = primaryReadinessFixture();
  fixture.expiresAt = 'not-a-date';
  expect(schema.safeParse(fixture).success).toBe(false);
  const second = primaryReadinessFixture();
  second.configuration.databaseHost = 'localhost';
  expect(schema.safeParse(second).success).toBe(false);
  const third = primaryReadinessFixture();
  third.roles.push(third.roles[0]);
  expect(schema.safeParse(third).success).toBe(false);
});
