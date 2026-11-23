import { expect, it } from 'vitest';
import {
  experienceOwnerSubject,
  experienceOwnerWireSchemas,
} from './experience-owner-wire';

const id = '11111111-1111-4111-8111-111111111111';
const envelope = {
  version: 1,
  nonce: 'a'.repeat(64),
  expiresAt: 1720000000000,
  accessToken: 'synthetic.jwt.token',
};

const operations = [
  [
    'owner-preview/v1',
    { input: { merchantId: id, buildId: id, routeId: '/' } },
  ],
  ['verifier-attest/v1', { approvalId: id, kind: 'draft' }],
  ['verifier-public/v1', { approvalId: id }],
] as const;

it.each(operations)('validates the strict %s envelope', (operation, fields) => {
  const schema = experienceOwnerWireSchemas[operation];
  const valid = { ...envelope, ...fields };
  expect(schema.parse(valid)).toEqual(valid);
  for (const override of [
    { unexpected: true },
    { version: 2 },
    { nonce: 'a'.repeat(63) },
    { nonce: 'A'.repeat(64) },
    { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { expiresAt: 1.5 },
    { accessToken: '' },
    { accessToken: 'x'.repeat(8193) },
    { accessToken: 'Bearer synthetic' },
  ]) {
    expect(schema.safeParse({ ...valid, ...override }).success).toBe(false);
  }
  expect(
    schema.safeParse({ ...valid, accessToken: 'x'.repeat(8192) }).success
  ).toBe(true);
});

// These are signed bytes on the v1 wire. Changing the schema's output order
// requires a coordinated protocol rollout even though parsers accept reordered JSON.
it.each(
  operations
)('keeps the %s signing order when wire fields are reordered', (operation, fields) => {
  const reversedFields =
    'input' in fields
      ? { input: { routeId: '/', buildId: id, merchantId: id } }
      : 'kind' in fields
        ? { kind: fields.kind, approvalId: id }
        : { approvalId: id };
  const input = {
    ...reversedFields,
    accessToken: envelope.accessToken,
    expiresAt: envelope.expiresAt,
    nonce: envelope.nonce,
    version: envelope.version,
  };
  expect(
    JSON.stringify(experienceOwnerWireSchemas[operation].parse(input))
  ).toBe(JSON.stringify({ ...envelope, ...fields }));
});

it('accepts only the fields for each signed operation', () => {
  const preview = experienceOwnerWireSchemas['owner-preview/v1'];
  const attest = experienceOwnerWireSchemas['verifier-attest/v1'];
  const verify = experienceOwnerWireSchemas['verifier-public/v1'];
  expect(
    preview.safeParse({ ...envelope, input: { merchantId: id, buildId: id } })
      .success
  ).toBe(true);
  for (const input of [
    { merchantId: 'invalid', buildId: id },
    { merchantId: id, buildId: 'invalid' },
    { merchantId: id, buildId: id, routeId: 'x'.repeat(241) },
    { merchantId: id, buildId: id, approvalId: id },
  ]) {
    expect(preview.safeParse({ ...envelope, input }).success).toBe(false);
  }
  expect(
    attest.safeParse({ ...envelope, approvalId: id, kind: 'lifecycle' }).success
  ).toBe(true);
  expect(attest.safeParse({ ...envelope, approvalId: id }).success).toBe(false);
  expect(
    attest.safeParse({ ...envelope, approvalId: id, kind: 'publish' }).success
  ).toBe(false);
  expect(verify.safeParse({ ...envelope, approvalId: 'invalid' }).success).toBe(
    false
  );
  expect(
    verify.safeParse({ ...envelope, approvalId: id, kind: 'draft' }).success
  ).toBe(false);
});

it('requires a UUID subject for owner quota accounting', () => {
  expect(experienceOwnerSubject.parse(id)).toBe(id);
  for (const subject of [undefined, '', 'merchant-slug'])
    expect(experienceOwnerSubject.safeParse(subject).success).toBe(false);
});
