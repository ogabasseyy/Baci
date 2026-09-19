import { describe, expect, it } from 'vitest';
import {
  type BackfillImageCandidate,
  classifyFeedImageCandidate,
  extractImageCandidates,
} from './index';

// ---------- extractImageCandidates ----------
describe('extractImageCandidates', () => {
  it('extracts images from string array', () => {
    const images = [
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      'https://cdn.ogabassey.com/core-assets/products/phone-2.png',
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result).toEqual([
      {
        product_id: 'prod-1',
        source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        is_primary: true,
        position: 0,
      },
      {
        product_id: 'prod-1',
        source_url:
          'https://cdn.ogabassey.com/core-assets/products/phone-2.png',
        is_primary: false,
        position: 1,
      },
    ]);
  });

  it('extracts images from object array', () => {
    const images = [
      { url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif' },
      { url: 'https://cdn.ogabassey.com/core-assets/products/phone-2.png' },
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result).toHaveLength(2);
    expect(result[0].source_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif'
    );
  });

  it('handles mixed string and object arrays', () => {
    const images: Array<string | { url: string }> = [
      'https://cdn.ogabassey.com/core-assets/products/a.avif',
      { url: 'https://cdn.ogabassey.com/core-assets/products/b.png' },
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result).toHaveLength(2);
  });

  it('skips empty/blank URLs', () => {
    const images = [
      '',
      'https://cdn.ogabassey.com/core-assets/products/valid.jpg',
      '  ',
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result).toHaveLength(1);
    expect(result[0].source_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/valid.jpg'
    );
    expect(result[0].is_primary).toBe(true);
  });

  it('trims whitespace from URLs', () => {
    const images = [
      '  https://cdn.ogabassey.com/core-assets/products/phone.jpg  ',
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result[0].source_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
  });

  it('returns empty array for null/undefined images', () => {
    expect(extractImageCandidates('prod-1', null)).toEqual([]);
    expect(extractImageCandidates('prod-1', undefined)).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(extractImageCandidates('prod-1', [])).toEqual([]);
  });

  it('marks first valid image as primary', () => {
    const images = ['https://cdn.ogabassey.com/core-assets/products/a.jpg'];
    const result = extractImageCandidates('prod-1', images);
    expect(result[0].is_primary).toBe(true);
  });

  it('marks subsequent images as non-primary with incrementing position', () => {
    const images = [
      'https://cdn.ogabassey.com/core-assets/products/a.jpg',
      'https://cdn.ogabassey.com/core-assets/products/b.jpg',
      'https://cdn.ogabassey.com/core-assets/products/c.jpg',
    ];
    const result = extractImageCandidates('prod-1', images);
    expect(result[1].is_primary).toBe(false);
    expect(result[1].position).toBe(1);
    expect(result[2].is_primary).toBe(false);
    expect(result[2].position).toBe(2);
  });
});

// ---------- classifyFeedImageCandidate ----------
describe('classifyFeedImageCandidate', () => {
  const storefrontBaseUrl = 'https://ogabassey.com';

  it('classifies absolute JPG URL as pending_verification', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.verified_url).toBeNull();
    expect(result.verified_format).toBeNull();
    expect(result.status).toBe('pending_verification');
  });

  it('classifies absolute PNG URL as pending_verification', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.png',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.verified_url).toBeNull();
    expect(result.verified_format).toBeNull();
    expect(result.status).toBe('pending_verification');
  });

  it('classifies absolute WebP URL as pending_verification', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.webp',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.verified_url).toBeNull();
    expect(result.verified_format).toBeNull();
    expect(result.status).toBe('pending_verification');
  });

  it('classifies AVIF URL as pending_derivative', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
  });

  it('absolutizes relative path against storefront base URL', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '/game-covers/cyberpunk-2077.png',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.verified_url).toBe(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png'
    );
    expect(result.verified_format).toBe('png');
    expect(result.status).toBe('pending_verification');
  });

  it('marks relative path as invalid when storefrontBaseUrl is empty', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '/images/phone.jpg',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, '');
    expect(result.status).toBe('invalid');
    expect(result.verified_url).toBeNull();
    expect(result.failure_reason).toContain('storefrontBaseUrl is empty');
  });

  it('marks empty source_url as invalid', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('invalid');
    expect(result.verified_url).toBeNull();
    expect(result.failure_reason).toBeTruthy();
  });

  it('marks malformed URL as invalid', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'not-a-url',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toBeTruthy();
  });

  it('detects format correctly when URL has query string', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url:
        'https://cdn.ogabassey.com/core-assets/products/phone.jpg?v=123',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_verification');
    expect(result.verified_url).toBeNull();
    expect(result.verified_format).toBeNull();
  });

  it('prevents double slash when base URL has trailing slash', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '/game-covers/cyberpunk-2077.png',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(
      candidate,
      'https://ogabassey.com/'
    );
    expect(result.verified_url).toBe(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png'
    );
  });

  it('classifies relative AVIF path as pending_derivative', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '/products/phone.avif',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://ogabassey.com/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
  });

  it('handles uppercase file extensions', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.JPG',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_verification');
    expect(result.verified_url).toBeNull();
    expect(result.verified_format).toBeNull();
  });

  it('rewrites absolute AVIF URL with query string to JPG (drops query)', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url:
        'https://cdn.ogabassey.com/core-assets/products/phone.avif?v=1',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
  });

  it('rewrites absolute AVIF URL with fragment to JPG (drops fragment)', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url:
        'https://cdn.ogabassey.com/core-assets/products/phone.avif#section',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
  });

  it('rewrites relative AVIF path with query string to JPG (drops query)', () => {
    const candidate: BackfillImageCandidate = {
      product_id: 'prod-1',
      source_url: '/products/phone.avif?v=2',
      is_primary: true,
      position: 0,
    };
    const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://ogabassey.com/products/phone.jpg'
    );
  });

  it('marks unsupported formats as invalid', () => {
    for (const ext of ['.gif', '.svg', '.bmp', '.tiff']) {
      const candidate: BackfillImageCandidate = {
        product_id: 'prod-1',
        source_url: `https://cdn.ogabassey.com/core-assets/products/phone${ext}`,
        is_primary: true,
        position: 0,
      };
      const result = classifyFeedImageCandidate(candidate, storefrontBaseUrl);
      expect(result.status).toBe('invalid');
      expect(result.failure_reason).toBeTruthy();
    }
  });
});
