import { expect, it } from 'vitest';
import {
  experienceCaptureVerifierMessage,
  experienceCaptureVerifierOutput,
  experienceCaptureVerifierSelection,
} from './experience-capture-verifier';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'b'.repeat(64);
const selection = { buildId: id, routeId: 'home', idempotencyKey: id };

it('keeps the signed selection wire order and its existing bounds', () => {
  const message = {
    version: 1,
    nonce: digest,
    expiresAt: 1,
    accessToken: 'synthetic.token',
    merchantId: id,
    ...selection,
  };
  expect(JSON.stringify(experienceCaptureVerifierMessage.parse(message))).toBe(
    JSON.stringify(message)
  );
  expect(
    experienceCaptureVerifierSelection.safeParse({ ...selection, routeId: '' })
      .success
  ).toBe(false);
  expect(
    experienceCaptureVerifierMessage.safeParse({
      ...message,
      accessToken: 'bad token',
    }).success
  ).toBe(false);
});

it('requires a bounded receipt with exact digest formatting', () => {
  const receipt = {
    evidenceId: id,
    buildId: id,
    buildDigest: digest,
    previewUrl: 'https://preview.example.com/',
  };
  expect(experienceCaptureVerifierOutput.parse(receipt)).toEqual(receipt);
  expect(
    experienceCaptureVerifierOutput.safeParse({
      ...receipt,
      buildDigest: 'bad',
    }).success
  ).toBe(false);
});
