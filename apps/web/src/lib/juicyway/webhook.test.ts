import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from './webhook';

async function computeHmac(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(message)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyWebhookSignature', () => {
  const event = 'payment.session.succeeded';
  const businessId = 'biz_test_123';
  const data = {
    amount: 5000,
    currency: 'NGN',
    id: 'pay_abc',
    reference: 'ref_001',
  };

  it('verifies a provider signature when the configured business ID has surrounding whitespace', async () => {
    const checksum = await computeHmac(
      `${event}|${JSON.stringify(data)}`,
      businessId
    );

    expect(
      await verifyWebhookSignature(event, data, checksum, ` ${businessId}\n`)
    ).toBe(true);
  });

  it('fails closed when the configured business ID is whitespace only', async () => {
    expect(await verifyWebhookSignature(event, data, 'abcd', ' \n')).toBe(
      false
    );
  });

  it('returns true for a valid signature', async () => {
    const sortedData = {
      amount: 5000,
      currency: 'NGN',
      id: 'pay_abc',
      reference: 'ref_001',
    };
    const message = `${event}|${JSON.stringify(sortedData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      event,
      data,
      checksum,
      businessId
    );

    expect(result).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const result = await verifyWebhookSignature(
      event,
      data,
      'invalid_checksum_value_that_is_clearly_wrong',
      businessId
    );

    expect(result).toBe(false);
  });

  it('sorts data keys alphabetically before computing signature', async () => {
    const unsortedData = {
      reference: 'ref_001',
      amount: 5000,
      id: 'pay_abc',
      currency: 'NGN',
    };
    const sortedData = {
      amount: 5000,
      currency: 'NGN',
      id: 'pay_abc',
      reference: 'ref_001',
    };
    const message = `${event}|${JSON.stringify(sortedData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      event,
      unsortedData,
      checksum,
      businessId
    );

    expect(result).toBe(true);
  });

  it('is case-insensitive for checksum comparison', async () => {
    const sortedData = {
      amount: 5000,
      currency: 'NGN',
      id: 'pay_abc',
      reference: 'ref_001',
    };
    const message = `${event}|${JSON.stringify(sortedData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      event,
      data,
      checksum.toUpperCase(),
      businessId
    );

    expect(result).toBe(true);
  });

  it('returns false when event differs', async () => {
    const sortedData = {
      amount: 5000,
      currency: 'NGN',
      id: 'pay_abc',
      reference: 'ref_001',
    };
    const message = `${event}|${JSON.stringify(sortedData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      'payment.session.failed',
      data,
      checksum,
      businessId
    );

    expect(result).toBe(false);
  });

  it('returns false when businessId differs', async () => {
    const sortedData = {
      amount: 5000,
      currency: 'NGN',
      id: 'pay_abc',
      reference: 'ref_001',
    };
    const message = `${event}|${JSON.stringify(sortedData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      event,
      data,
      checksum,
      'different_business_id'
    );

    expect(result).toBe(false);
  });

  it('handles empty data object', async () => {
    const emptyData = {};
    const message = `${event}|${JSON.stringify(emptyData)}`;
    const checksum = await computeHmac(message, businessId);

    const result = await verifyWebhookSignature(
      event,
      emptyData,
      checksum,
      businessId
    );

    expect(result).toBe(true);
  });
});
