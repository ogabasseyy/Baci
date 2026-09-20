import { describe, expect, it } from 'vitest';
import { getClassifiedImageVerificationUrl } from './gmc-feed-verifier';

// ---------- getClassifiedImageVerificationUrl ----------
describe('getClassifiedImageVerificationUrl', () => {
  it('uses the original CDN AVIF URL for pending derivative verification', () => {
    const result = getClassifiedImageVerificationUrl({
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      verified_url: 'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
      status: 'pending_derivative',
    });

    expect(result).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif'
    );
  });

  it('keeps a verified URL for non-derivative candidates', () => {
    const result = getClassifiedImageVerificationUrl({
      source_url: 'https://example.com/products/phone.png',
      verified_url: 'https://store.example/products/phone.png',
      status: 'pending_verification',
    });

    expect(result).toBe('https://store.example/products/phone.png');
  });
});
