import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatProductResult } from '@/ai/chat-product-result';
import {
  findNamedEkaetteProduct,
  researchEkaetteProduct,
} from './ekaette-product-research';

const makeProduct = (
  overrides: Partial<ChatProductResult> = {}
): ChatProductResult => ({
  id: 'prod-1',
  name: 'iPhone 13',
  slug: 'iphone-13',
  brand: 'Apple',
  category: 'Smartphones',
  description: 'Apple smartphone',
  price: 385000,
  stock: 5,
  status: 'active',
  image_url: null,
  ...overrides,
});

describe('findNamedEkaetteProduct', () => {
  it('returns the exact matching product when unambiguous', () => {
    const iphone13 = makeProduct();
    const iphone14 = makeProduct({
      id: 'prod-2',
      name: 'iPhone 14',
      slug: 'iphone-14',
    });
    expect(
      findNamedEkaetteProduct('Does the iPhone 13 support MagSafe?', [
        iphone13,
        iphone14,
      ])
    ).toBe(iphone13);
  });

  it('rejects a base model match when the question specifies a qualifier like Pro', () => {
    const iphone13 = makeProduct();
    expect(
      findNamedEkaetteProduct('Does iPhone 13 Pro support ProMotion?', [
        iphone13,
      ])
    ).toBeUndefined();
  });

  it('returns undefined when multiple catalog products match', () => {
    const first = makeProduct({ id: 'p1', slug: 'iphone-13' });
    const second = makeProduct({
      id: 'p2',
      name: 'iPhone 13 Pro',
      slug: 'iphone-13-pro',
    });
    expect(
      findNamedEkaetteProduct('Compare iPhone 13 and iPhone 13 Pro', [
        first,
        second,
      ])
    ).toBeUndefined();
  });
});

describe('researchEkaetteProduct', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-research-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('returns a grounded reply with a sanitized manufacturer source URL', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'completed',
        output: [
          { type: 'web_search_call', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'iPhone 13 supports MagSafe wireless charging up to 15W.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://support.apple.com/en-us/111872?utm_source=test#top',
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    const result = await researchEkaetteProduct({
      model: 'gpt-4.1-mini',
      topic: 'MagSafe support',
      product: makeProduct(),
    });

    expect(result).toEqual({
      reply:
        'iPhone 13 supports MagSafe wireless charging up to 15W.\nSource: https://support.apple.com/en-us/111872',
      confidence: 0.9,
      needsHuman: false,
      intent: 'details',
    });
  });

  it('rejects answers whose citations point outside the manufacturer domain', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'completed',
        output: [
          { type: 'web_search_call', status: 'completed' },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Unverified blog claim.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://random-blog.example.com/iphone-13',
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'MagSafe support',
        product: makeProduct(),
      })
    ).toBeNull();
  });

  it('returns null for malformed responses, missing search call, or provider failure', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 'completed', output: [] })
    );
    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'camera specifications',
        product: makeProduct(),
      })
    ).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response('error', { status: 503 }));
    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'camera specifications',
        product: makeProduct(),
      })
    ).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error('network error'));
    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'camera specifications',
        product: makeProduct(),
      })
    ).toBeNull();
  });

  it('returns null without calling fetch when brand is unsupported or API key is missing', async () => {
    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'key technical specifications',
        product: makeProduct({ brand: 'UnknownBrand' }),
      })
    ).toBeNull();

    vi.stubEnv('OPENAI_API_KEY', '');
    expect(
      await researchEkaetteProduct({
        model: 'gpt-4.1-mini',
        topic: 'key technical specifications',
        product: makeProduct(),
      })
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
