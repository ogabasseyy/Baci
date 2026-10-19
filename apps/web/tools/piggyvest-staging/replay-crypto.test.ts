import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptAndValidateReceipt,
  decryptSealedReceipt,
} from './replay-crypto';

const key = Buffer.alloc(32, 7);

const event = {
  eventId: 'evt-replay-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'provider-customer-001',
  eventData: {
    id: 'event-data-001',
    customer_id: 'provider-customer-001',
    destination_wallet_id: 'conduit-wallet-001',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: 'synthetic',
    ip_address: '127.0.0.1',
    transaction_id: 'transaction-001',
    timestamp: '2026-09-18T17:57:47.566Z',
    status: 'COMPLETED',
    third_party_reference: 'third-party-001',
    initiator_reference: 'initiator-001',
    internal_reference: 'internal-001',
    provider: 'FAAS',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'reference-001',
    fee: 0,
  },
  pvb_reference: 'pvb-reference-001',
  pvb_wallet: 'api-wallet-001',
};

function seal(raw: Buffer, overrides: Record<string, unknown> = {}) {
  const payloadSha256 =
    typeof overrides.payloadSha256 === 'string'
      ? overrides.payloadSha256
      : createHash('sha256').update(raw).digest('hex');
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`));
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    payloadSha256,
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 'staging-v1' as const,
    ...overrides,
  };
}

function validReceipt() {
  return seal(Buffer.from(JSON.stringify(event), 'utf8'));
}

describe('staging replay receipt validation', () => {
  it('preserves an explicit null session through authenticated receipt decryption', () => {
    const raw = Buffer.from(
      JSON.stringify({
        ...event,
        eventData: { ...event.eventData, session_id: null },
      })
    );
    const result = decryptAndValidateReceipt(seal(raw), key, event.eventId);
    expect(result.raw).toEqual(raw);
    expect(result.event.eventData).toHaveProperty('session_id', null);
  });

  it('decrypts exact UTF-8 JSON and preserves a distinct nested destination wallet', () => {
    const result = decryptAndValidateReceipt(
      validReceipt(),
      key,
      'evt-replay-001'
    );
    expect(result.event.eventId).toBe('evt-replay-001');
    expect(result.event).toHaveProperty('pvb_wallet', 'api-wallet-001');
    if (result.event.eventType === 'bank-transfer.inflow.success') {
      expect(result.event.eventData.destination_wallet_id).toBe(
        'conduit-wallet-001'
      );
    }
  });

  it.each([
    [
      'tampered ciphertext',
      (receipt: ReturnType<typeof validReceipt>) => ({
        ...receipt,
        ciphertext: Buffer.from('tampered').toString('base64'),
      }),
    ],
    ['wrong key', (receipt: ReturnType<typeof validReceipt>) => receipt],
    [
      'wrong digest',
      (receipt: ReturnType<typeof validReceipt>) => ({
        ...receipt,
        payloadSha256: 'ab'.repeat(32),
      }),
    ],
  ])('rejects %s', (name, makeReceipt) => {
    const receipt = makeReceipt(validReceipt());
    const suppliedKey = name === 'wrong key' ? Buffer.alloc(32, 8) : key;
    expect(() =>
      decryptAndValidateReceipt(receipt, suppliedKey, 'evt-replay-001')
    ).toThrow();
  });

  it('rejects invalid UTF-8 before JSON interpretation', () => {
    const receipt = seal(Buffer.from([0xc3, 0x28]));
    expect(() =>
      decryptAndValidateReceipt(receipt, key, 'evt-replay-001')
    ).toThrow();
  });

  it('rejects a nested customer mismatch', () => {
    const mismatched = {
      ...event,
      eventData: { ...event.eventData, customer_id: 'other-customer' },
    };
    const receipt = seal(Buffer.from(JSON.stringify(mismatched), 'utf8'));
    expect(() =>
      decryptAndValidateReceipt(receipt, key, 'evt-replay-001')
    ).toThrow();
  });

  it('rejects a receipt whose event id differs from the durable lease identity', () => {
    expect(() =>
      decryptAndValidateReceipt(validReceipt(), key, 'other-event')
    ).toThrow();
  });
});

describe('decryptSealedReceipt (unbound claim-time decrypt)', () => {
  it('returns the authentic event without an expected id', () => {
    const result = decryptSealedReceipt(validReceipt(), key);
    expect(result.event.eventId).toBe('evt-replay-001');
  });

  it('fails closed on tampering exactly like the bound path', () => {
    const receipt = {
      ...validReceipt(),
      ciphertext: Buffer.from('tampered').toString('base64'),
    };
    expect(() => decryptSealedReceipt(receipt, key)).toThrow();
  });
});
