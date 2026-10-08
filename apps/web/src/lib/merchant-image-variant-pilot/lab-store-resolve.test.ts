import { describe, expect, it } from 'vitest';
import type { PilotLabConfig } from './lab-config';
import { resolveBinding, statusFor } from './lab-store-resolve';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const BINDING = {
  assetId: 'logo-1',
  merchantId: MERCHANT,
  originalUrl: 'https://cdn.example.com/media/logo.png',
  role: 'logo' as const,
  slotId: 'header-logo',
  sourceSha256: 'd'.repeat(64),
};

function configWith(statuses: PilotLabConfig['statuses']): PilotLabConfig {
  return {
    baseUrl: '/__pilot',
    bindings: [BINDING],
    index: { entries: {} },
    originalUrlFor: () => null,
    stagedPaths: [],
    statuses,
  };
}

describe('statusFor', () => {
  it('finds the merchant/slot status and misses others', () => {
    const status = { binding: BINDING, status: 'accepted' as const };
    const config = configWith([status]);
    expect(statusFor(config, MERCHANT, 'header-logo')).toBe(status);
    expect(statusFor(config, MERCHANT, 'product-card')).toBeNull();
    expect(
      statusFor(config, 'de968340-de02-4aa8-95f9-9d5f7d2b1f20', 'header-logo')
    ).toBeNull();
  });
});

describe('resolveBinding', () => {
  it('pairs staged tiers with the staged original URL', () => {
    const tiers = [
      {
        actualWidth: 48,
        bytes: 100,
        contentType: 'image/webp' as const,
        delivery: 'generated' as const,
        fileName: 'tier.webp',
        format: 'webp' as const,
        generationId: 'c'.repeat(64),
        height: 48,
        quality: 70 as const,
        requestedWidth: 48,
        sha256: 'e'.repeat(64),
        width: 48,
      },
    ];
    const config: PilotLabConfig = {
      ...configWith([]),
      index: {
        entries: {
          [`${MERCHANT}/logo-1/${'d'.repeat(64)}/logo`]: tiers,
        },
      },
      originalUrlFor: () => '/__pilot/originals/logo.png',
    };
    const { resolved, stagedOriginal } = resolveBinding(config, BINDING);
    expect(resolved?.tiers).toBe(tiers);
    expect(stagedOriginal).toBe('/__pilot/originals/logo.png');
  });

  it('resolves nothing when tiers or the original are unstaged', () => {
    const config = configWith([]);
    const { resolved, stagedOriginal } = resolveBinding(config, BINDING);
    expect(resolved).toBeNull();
    expect(stagedOriginal).toBeNull();
  });
});
