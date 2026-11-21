import { describe, expect, it } from 'vitest';
import {
  isReservedMerchantSlug,
  isSlugShapedIdentifier,
  isValidMerchantIdentifier,
  isValidMerchantSlug,
} from '@/lib/validation';

describe('validation reserved storefront paths', () => {
  it('accepts a normal merchant slug', () => {
    expect(isValidMerchantSlug('acme-store')).toBe(true);
    expect(isValidMerchantIdentifier('acme-store')).toBe(true);
  });

  it('rejects image asset namespace as a merchant slug', () => {
    expect(isValidMerchantSlug('images')).toBe(false);
    expect(isValidMerchantIdentifier('images')).toBe(false);
  });

  it('rejects the legacy singular product namespace as a merchant slug', () => {
    expect(isValidMerchantSlug('product')).toBe(false);
    expect(isValidMerchantIdentifier('product')).toBe(false);
  });

  it('rejects the staff platform route as a merchant slug', () => {
    expect(isValidMerchantSlug('staff')).toBe(false);
    expect(isValidMerchantIdentifier('staff')).toBe(false);
  });
});

describe('isSlugShapedIdentifier', () => {
  it('accepts a well-formed slug regardless of the reserved list', () => {
    // A retired slug that later became reserved (e.g. a store that used 'staff'
    // before it was reserved, then renamed) is still a valid ALIAS key even
    // though isValidMerchantSlug now rejects it.
    expect(isSlugShapedIdentifier('staff')).toBe(true);
    expect(isValidMerchantSlug('staff')).toBe(false);
    expect(isSlugShapedIdentifier('acme-store')).toBe(true);
  });

  it('rejects domain-shaped and malformed identifiers', () => {
    expect(isSlugShapedIdentifier('ogabassey.com')).toBe(false);
    expect(isSlugShapedIdentifier('-leading-hyphen')).toBe(false);
    expect(isSlugShapedIdentifier('')).toBe(false);
    expect(isSlugShapedIdentifier('has space')).toBe(false);
  });
});

describe('isReservedMerchantSlug', () => {
  it('flags storefront route words AND infra subdomains (mirrors the DB guard)', () => {
    // Storefront routes (RESERVED_PATHS)
    expect(isReservedMerchantSlug('staff')).toBe(true);
    expect(isReservedMerchantSlug('wallet')).toBe(true);
    // Infra subdomains NOT in RESERVED_PATHS — the gap codex flagged
    expect(isReservedMerchantSlug('www')).toBe(true);
    expect(isReservedMerchantSlug('mail')).toBe(true);
    expect(isReservedMerchantSlug('smtp')).toBe(true);
    expect(isReservedMerchantSlug('cdn')).toBe(true);
  });

  it('is case-insensitive and trims', () => {
    expect(isReservedMerchantSlug('  WWW ')).toBe(true);
  });

  it('reserves the chat engine host so no store can take chat.<root domain>', () => {
    expect(isReservedMerchantSlug('chat')).toBe(true);
    expect(isReservedMerchantSlug(' Chat ')).toBe(true);
    // Only the exact label is reserved; store names that contain it stay free.
    expect(isReservedMerchantSlug('chat-store')).toBe(false);
    expect(isReservedMerchantSlug('livechat')).toBe(false);
  });

  it('accepts a normal store slug', () => {
    expect(isReservedMerchantSlug('acme-store')).toBe(false);
  });
});
