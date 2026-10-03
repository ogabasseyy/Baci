import { describe, expect, it } from 'vitest';
import type { ApprovedPilotTier, PilotLabIndex } from './lab-index';
import { resolvePilotSlot } from './resolver';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const SOURCE =
  'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98';

function tier(width: number): ApprovedPilotTier {
  return {
    actualWidth: width,
    bytes: 1000,
    contentType: 'image/webp',
    fileName: `${width}.webp`,
    format: 'webp',
    generationId: 'c'.repeat(64),
    height: width,
    quality: 70,
    requestedWidth: width,
    sha256: 'a'.repeat(64),
    width,
  };
}

const INDEX: PilotLabIndex = Object.freeze({
  entries: Object.freeze({
    [`${MERCHANT}/logo-1/${SOURCE}/logo`]: Object.freeze([tier(96), tier(192)]),
  }),
});

const BINDINGS = [
  {
    assetId: 'logo-1',
    merchantId: MERCHANT,
    originalUrl: 'https://cdn.example.com/media/logo.png',
    role: 'logo',
    slotId: 'header-logo',
    sourceSha256: SOURCE,
  },
] as const;

describe('resolvePilotSlot', () => {
  it('resolves bound slots to approved tiers with no I/O', () => {
    const resolved = resolvePilotSlot(INDEX, [...BINDINGS], {
      baseUrl: '/__pilot',
      merchantId: MERCHANT,
      originalUrl: 'https://cdn.example.com/media/logo.png',
      slotId: 'header-logo',
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.binding.assetId).toBe('logo-1');
    expect(resolved?.tiers).toHaveLength(2);
    expect(resolved?.baseUrl).toBe('/__pilot');
    expect(resolved instanceof Promise).toBe(false);
  });

  it('falls back to the control path on any mismatch', () => {
    expect(
      resolvePilotSlot(INDEX, [...BINDINGS], {
        baseUrl: '/__pilot',
        merchantId: MERCHANT,
        originalUrl: 'https://cdn.example.com/media/rotated.png',
        slotId: 'header-logo',
      })
    ).toBeNull();
    expect(
      resolvePilotSlot(INDEX, [...BINDINGS], {
        baseUrl: '/__pilot',
        merchantId: MERCHANT,
        originalUrl: 'https://cdn.example.com/media/logo.png',
        slotId: 'unknown-slot',
      })
    ).toBeNull();
  });

  it('returns null when the index entry is absent', () => {
    const empty: PilotLabIndex = Object.freeze({ entries: Object.freeze({}) });
    expect(
      resolvePilotSlot(empty, [...BINDINGS], {
        baseUrl: '/__pilot',
        merchantId: MERCHANT,
        originalUrl: 'https://cdn.example.com/media/logo.png',
        slotId: 'header-logo',
      })
    ).toBeNull();
  });
});
