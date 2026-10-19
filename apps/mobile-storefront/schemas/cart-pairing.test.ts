import {
  nativeHandoffPreviewSchema,
  nativePairingHintSchema,
} from './cart-pairing';

describe('nativePairingHintSchema', () => {
  it('accepts web and native storefront destinations', () => {
    expect(
      nativePairingHintSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        destination: { type: 'web' },
      }).success
    ).toBe(true);
    expect(
      nativePairingHintSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        destination: { type: 'native', app: 'storefront' },
      }).success
    ).toBe(true);
  });

  it('rejects other native apps', () => {
    expect(
      nativePairingHintSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        destination: { type: 'native', app: 'admin' },
      }).success
    ).toBe(false);
  });
});

describe('nativeHandoffPreviewSchema', () => {
  it('accepts a pending preview without a snapshot', () => {
    expect(
      nativeHandoffPreviewSchema.safeParse({
        status: 'pending',
        merchant: null,
        snapshot: null,
        expiresAt: null,
      }).success
    ).toBe(true);
  });

  it('rejects unknown statuses', () => {
    expect(
      nativeHandoffPreviewSchema.safeParse({
        status: 'redeemed',
        merchant: null,
        snapshot: null,
        expiresAt: null,
      }).success
    ).toBe(false);
  });
});
