import { expect, it } from 'vitest';
import {
  experienceBuildVerifierMessage,
  experienceBuildVerifierReceipt,
  experienceBuildVerifierRequest,
} from './experience-build-verifier';

const id = '11111111-1111-4111-8111-111111111111';
const receipt = {
  merchantId: id,
  jobId: id,
  attemptNonce: id,
  buildDigest: 'b'.repeat(64),
  receiptDigest: 'c'.repeat(64),
  hostOrigin: 'https://shop.example.com',
};
const message = {
  version: 1,
  nonce: 'a'.repeat(64),
  expiresAt: 1795370000000,
  accessToken: 'synthetic.token',
  ...receipt,
};

it('keeps the signed wire field order and shares the receipt field validation', () => {
  expect(JSON.stringify(experienceBuildVerifierMessage.parse(message))).toBe(
    JSON.stringify(message)
  );
  expect(experienceBuildVerifierReceipt.parse(receipt)).toEqual(receipt);
  for (const patch of [
    { buildDigest: 'bad' },
    { jobId: 'bad' },
    { extra: true },
  ]) {
    expect(
      experienceBuildVerifierReceipt.safeParse({ ...receipt, ...patch }).success
    ).toBe(false);
    expect(
      experienceBuildVerifierMessage.safeParse({ ...message, ...patch }).success
    ).toBe(false);
  }
});

it('rejects invalid verifier envelope fields', () => {
  for (const patch of [
    { version: 2 },
    { nonce: 'bad' },
    { accessToken: 'two words' },
    { expiresAt: 1.5 },
  ]) {
    expect(
      experienceBuildVerifierMessage.safeParse({ ...message, ...patch }).success
    ).toBe(false);
  }
});

it('uses the receipt fields without repeating the merchant locator in verifier input', () => {
  const { merchantId, ...input } = receipt;
  expect(experienceBuildVerifierRequest.parse(input)).toEqual(input);
  expect(
    experienceBuildVerifierRequest.safeParse({ ...input, merchantId }).success
  ).toBe(false);
});
