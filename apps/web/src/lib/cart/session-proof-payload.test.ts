import { describe, expect, it } from 'vitest';
import {
  decodeProofPayload,
  encodeProofPayload,
  type ProofPayload,
} from './session-proof-payload';

const payload: ProofPayload = {
  aud: 'cart',
  cartId: '3f6d8a52-2f4b-4c1d-9c3a-7d5e6f8091a2',
  env: 'test',
  exp: 1_900_000_000,
  grantId: null,
  iat: 1_800_000_000,
  merchantId: '1a2b3c4d-5e6f-4a5b-8c7d-9e0f1a2b3c4d',
  ops: ['add', 'set_quantity'],
  principalId: 'device-1',
  scope: 'session',
  v: 'cp1',
};

describe('proof payload codec', () => {
  it('round-trips a valid payload', () => {
    expect(decodeProofPayload(encodeProofPayload(payload))).toEqual(payload);
  });

  it('rejects malformed and schema-invalid payloads', () => {
    expect(decodeProofPayload('not-a-proof')).toBeNull();
    const wrongVersion = Buffer.from(
      JSON.stringify({ ...payload, v: 'cp0' })
    ).toString('base64url');
    expect(decodeProofPayload(wrongVersion)).toBeNull();
    const unknownKey = Buffer.from(
      JSON.stringify({ ...payload, extra: true })
    ).toString('base64url');
    expect(decodeProofPayload(unknownKey)).toBeNull();
  });

  it('rejects unknown grant operations', () => {
    const badOps = Buffer.from(
      JSON.stringify({ ...payload, ops: ['teleport'] })
    ).toString('base64url');
    expect(decodeProofPayload(badOps)).toBeNull();
  });
});
