import { describe, expect, it } from 'vitest';
import { previewSafeLinks } from './builder-preview-safe-links';

describe('previewSafeLinks', () => {
  it('accepts bounded supported social URLs and legacy zone names', () => {
    expect(
      previewSafeLinks.isSafeSocialLinks({
        instagram: 'https://instagram.com/store',
        linkedin: '',
      })
    ).toBe(true);
    expect(previewSafeLinks.isLegacyZoneKey('aside')).toBe(true);
  });

  it('rejects unsupported platforms, unsafe URLs, and invalid zone names', () => {
    expect(
      previewSafeLinks.isSafeSocialLinks({ tracking: 'https://evil.test' })
    ).toBe(false);
    expect(
      previewSafeLinks.isSafeSocialLinks({ instagram: 'javascript:alert(1)' })
    ).toBe(false);
    expect(previewSafeLinks.isLegacyZoneKey('bad zone')).toBe(false);
    expect(
      previewSafeLinks.isSafeSocialLinks({
        tiktok: 'https://www.tiktok.com/@store',
      })
    ).toBe(false);
  });
});
