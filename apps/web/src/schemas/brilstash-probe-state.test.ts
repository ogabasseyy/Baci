import { expect, it } from 'vitest';
import { brilStashProbeStateSchema } from './brilstash-probe-state';

const id = '30000000-0000-4000-8000-000000000001';
const state = {
  installationId: id,
  generationId: id,
  credentialId: id,
  catalogueRevision: '9007199254740993',
  servingRevision: '7',
  credentialRevision: '0',
  payloadDigest: 'a'.repeat(64),
  totalCount: 7,
};

it('preserves the exact revisions and maximum pilot count', () => {
  expect(brilStashProbeStateSchema.parse(state)).toEqual(state);
});

it.each([
  { totalCount: 0 },
  { totalCount: 8 },
  { totalCount: 1.5 },
  { servingRevision: 7 },
  { credentialRevision: '-1' },
  { generationId: 'bad' },
  { payloadDigest: 'a'.repeat(65) },
])('rejects invalid probe state %#', (override) => {
  expect(
    brilStashProbeStateSchema.safeParse({ ...state, ...override }).success
  ).toBe(false);
});
