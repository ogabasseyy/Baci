import { describe, expect, it } from 'vitest';
import { findPilotBinding, parsePilotInventory } from './pilot-inventory';

const MERCHANT_A = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const MERCHANT_B = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';
const SHA_A =
  'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98';
const SHA_B =
  '0cf419ccbfd79d65690db7b376d66a75fd0df4ae42dc206bcc2d191ddee7c064';

function binding(overrides = {}) {
  return {
    assetId: 'logo-1',
    merchantId: MERCHANT_A,
    originalUrl: 'https://cdn.example.com/media/logo.png',
    role: 'logo',
    slotId: 'header-logo',
    sourceSha256: SHA_A,
    ...overrides,
  };
}

describe('parsePilotInventory', () => {
  it('accepts a bounded inventory with distinct slots', () => {
    const result = parsePilotInventory([
      binding(),
      binding({
        assetId: 'product-1',
        originalUrl: 'https://cdn.example.com/media/product.png',
        role: 'product',
        slotId: 'product-card-0',
        sourceSha256: SHA_B,
      }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bindings).toHaveLength(2);
    }
  });

  it('allows identical bytes under different merchant assets', () => {
    const result = parsePilotInventory([
      binding(),
      binding({ merchantId: MERCHANT_B, slotId: 'other-header-logo' }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects over-cap inventories and duplicate slot or asset keys', () => {
    const many = Array.from({ length: 21 }, (_, index) =>
      binding({ assetId: `asset-${index}`, slotId: `slot-${index}` })
    );
    expect(parsePilotInventory(many).ok).toBe(false);

    expect(
      parsePilotInventory([binding(), binding({ assetId: 'logo-2' })]).ok
    ).toBe(false);

    expect(
      parsePilotInventory([
        binding(),
        binding({
          originalUrl: 'https://cdn.example.com/media/other.png',
          slotId: 'other',
        }),
      ]).ok
    ).toBe(false);
  });

  it('rejects non-array input and invalid members', () => {
    expect(parsePilotInventory({}).ok).toBe(false);
    const result = parsePilotInventory([
      binding(),
      binding({ role: 'banner' }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join('\n')).toMatch(/binding 1/);
    }
  });
});

describe('findPilotBinding', () => {
  it('resolves only on exact merchant, slot, and original URL', () => {
    const parsed = parsePilotInventory([binding()]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(
      findPilotBinding(parsed.bindings, {
        merchantId: MERCHANT_A,
        originalUrl: 'https://cdn.example.com/media/logo.png',
        slotId: 'header-logo',
      })?.assetId
    ).toBe('logo-1');
    // A rotated original URL invalidates the binding instead of mismatching.
    expect(
      findPilotBinding(parsed.bindings, {
        merchantId: MERCHANT_A,
        originalUrl: 'https://cdn.example.com/media/logo-v2.png',
        slotId: 'header-logo',
      })
    ).toBeNull();
    expect(
      findPilotBinding(parsed.bindings, {
        merchantId: MERCHANT_B,
        originalUrl: 'https://cdn.example.com/media/logo.png',
        slotId: 'header-logo',
      })
    ).toBeNull();
  });
});
