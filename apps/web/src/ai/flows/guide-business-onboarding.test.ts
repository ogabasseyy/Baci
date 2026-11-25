import { generateObject, generateText } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { fetchImageBytes } from '@/lib/fetch-image-bytes';
import { isPublicHttpUrl } from '@/lib/is-public-http-url';
import { generateOpenAiLogo } from './generate-openai-logo';
import { guideBusinessOnboarding } from './guide-business-onboarding';
import { runGuideBusinessOnboarding } from './guide-business-onboarding.core';

vi.mock('./generate-openai-logo', () => ({
  generateOpenAiLogo: vi.fn(async () => null),
}));

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: vi.fn(async () => true),
}));

// generateObjectWithChain / getVisionProviderChain (the real executors, not
// mocked below) construct their default chain via @/ai/provider — extend
// rather than replace this mock so construction keeps working.
vi.mock('@/ai/provider', () => ({
  ACTIVE_TEXT_MODEL_NAME: 'gemini-2.5-flash',
  activeImageModel: 'test-image-model',
  activeTextModel: 'test-text-model',
  FALLBACK_TEXT_MODEL_NAME: 'gemini-2.5-flash-lite',
  fallbackTextModel: 'test-text-model-lite',
  sanitizePromptInput: (input: string, limit: number) => ({
    value: input.slice(0, limit),
    metadata: {
      wasTruncated: input.length > limit,
      originalLength: input.length,
      finalLength: Math.min(input.length, limit),
      limit,
    },
  }),
  withRetry: vi.fn((operation: () => Promise<unknown>) => operation()),
}));

vi.mock('@/lib/fetch-image-bytes', () => ({
  fetchImageBytes: vi.fn(),
}));

vi.mock('@/lib/is-public-http-url', () => ({
  isPublicHttpUrl: vi.fn(async () => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockGenerateText = vi.mocked(generateText);
const mockGenerateObject = vi.mocked(generateObject);
const mockEnsureActionRateLimit = vi.mocked(ensureActionRateLimit);
const mockFetchImageBytes = vi.mocked(fetchImageBytes);
const mockIsPublicHttpUrl = vi.mocked(isPublicHttpUrl);
const mockGenerateOpenAiLogo = vi.mocked(generateOpenAiLogo);

describe('guideBusinessOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force the deterministic Gemini-only chain (no OpenAI/Cerebras/Groq keys) so
    // provider-count assertions below are stable regardless of ambient env.
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CEREBRAS_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    mockEnsureActionRateLimit.mockResolvedValue(true);
    mockIsPublicHttpUrl.mockResolvedValue(true);
    // Default: no bytes available, so extract_colors tests exercise the
    // URL-based Gemini fallback unless a test opts into the bytes path.
    mockFetchImageBytes.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects rate-limited callers before invoking any AI model', async () => {
    mockEnsureActionRateLimit.mockResolvedValueOnce(false);

    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Style',
        businessType: 'fashion',
        brandPreferences: 'rose and gold',
        task: 'generate_logos',
      })
    ).rejects.toThrow('Too many AI onboarding requests');

    expect(mockEnsureActionRateLimit).toHaveBeenCalledWith('ai-onboarding', {
      requests: 10,
      windowMs: 600_000,
    });
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('rejects invalid input before invoking any AI model', async () => {
    await expect(
      guideBusinessOnboarding({
        businessName: 'a'.repeat(201),
        businessType: 'fashion',
        brandPreferences: 'rose and gold',
        task: 'generate_logos',
      })
    ).rejects.toThrow('Invalid onboarding input provided.');

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('returns a fallback logo and brand colors when AI logo generation is quota exhausted', async () => {
    mockGenerateText.mockRejectedValueOnce(
      new Error('RESOURCE_EXHAUSTED: quota exceeded')
    );

    const result = await guideBusinessOnboarding({
      businessName: 'Baci E2E Food',
      businessType: 'food-beverage',
      brandPreferences: 'fresh green and cream',
      task: 'generate_logos',
    });

    expect(result.logos?.[0]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(result.brandColors).toMatchObject({
      primary: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      background: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      accent: expect.stringMatching(/^#[0-9A-F]{6}$/i),
    });
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 })
    );
  });

  it('returns generated logo data when image generation succeeds', async () => {
    mockGenerateText.mockResolvedValueOnce({
      files: [
        {
          mediaType: 'image/png',
          base64: 'abc123',
        },
      ],
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await guideBusinessOnboarding({
      businessName: 'Baci Style',
      businessType: 'fashion',
      brandPreferences: 'rose and gold',
      task: 'generate_logos',
    });

    expect(result).toEqual({
      logos: ['data:image/png;base64,abc123'],
      brandColors: {
        primary: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        background: expect.stringMatching(/^#[0-9A-F]{6}$/i),
        accent: expect.stringMatching(/^#[0-9A-F]{6}$/i),
      },
    });
  });

  it('fails closed without invoking AI when guarded image byte fetch returns null', async () => {
    mockFetchImageBytes.mockResolvedValueOnce(null);

    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Meds',
        businessType: 'pharmaceuticals',
        brandPreferences: 'green',
        logoUrl: 'https://example.com/logo.png',
        task: 'extract_colors',
      })
    ).rejects.toThrow('Failed to extract brand colors.');

    expect(mockFetchImageBytes).toHaveBeenCalledWith(
      'https://example.com/logo.png'
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('extracts brand colors from fetched image bytes via the vision chain when bytes are available', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetchImageBytes.mockResolvedValueOnce({
      bytes,
      mediaType: 'image/png',
    });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        primary: '#222222',
        background: '#FAFAFA',
        accent: '#0EA5E9',
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await guideBusinessOnboarding({
      businessName: 'Baci Meds',
      businessType: 'pharmaceuticals',
      brandPreferences: 'green',
      logoUrl: 'https://example.com/logo.png',
      task: 'extract_colors',
    });

    expect(result.brandColors).toEqual({
      primary: '#222222',
      background: '#FAFAFA',
      accent: '#0EA5E9',
    });
    // The vision-chain executor (real, not mocked) forwards raw bytes +
    // mediaType instead of the logo URL.
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: [{ type: 'image', image: bytes, mediaType: 'image/png' }],
          }),
        ]),
      })
    );
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next vision-chain provider when the first one fails', async () => {
    mockFetchImageBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    mockGenerateObject
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValueOnce({
        object: {
          primary: '#333333',
          background: '#FFFFFF',
          accent: '#10B981',
        },
      } as Awaited<ReturnType<typeof generateObject>>);

    const result = await guideBusinessOnboarding({
      businessName: 'Baci Meds',
      businessType: 'pharmaceuticals',
      brandPreferences: 'green',
      logoUrl: 'https://example.com/logo.png',
      task: 'extract_colors',
    });

    expect(result.brandColors).toEqual({
      primary: '#333333',
      background: '#FFFFFF',
      accent: '#10B981',
    });
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('throws the stable extraction error once the vision chain is exhausted', async () => {
    mockFetchImageBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    mockGenerateObject.mockRejectedValue(new Error('all providers down'));

    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Meds',
        businessType: 'pharmaceuticals',
        brandPreferences: 'green',
        logoUrl: 'https://example.com/logo.png',
        task: 'extract_colors',
      })
    ).rejects.toThrow('Failed to extract brand colors.');
    // Gemini-only vision chain in tests: both Gemini and Gemini-Lite are
    // attempted before the chain's exhaustion error reaches the flow.
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('generates business name suggestions from a description', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        businessNames: [
          'Glow Bar',
          'Velvet Bloom',
          'Aura Supply',
          'Nova Beauty',
          'Lush Desk',
          'Tone Market',
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await guideBusinessOnboarding({
      businessName: 'Starter',
      businessType: 'health-beauty',
      brandPreferences: 'pink',
      description: 'A beauty shop focused on clean skincare',
      tone: 'Premium',
      task: 'generate_names',
    });

    expect(result.businessNames).toEqual([
      'Glow Bar',
      'Velvet Bloom',
      'Aura Supply',
      'Nova Beauty',
      'Lush Desk',
      'Tone Market',
    ]);
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next chain provider when name generation first fails', async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValueOnce({
        object: { businessNames: ['Glow Bar'] },
      } as Awaited<ReturnType<typeof generateObject>>);

    const result = await guideBusinessOnboarding({
      businessName: 'Starter',
      businessType: 'health-beauty',
      brandPreferences: 'pink',
      description: 'A beauty shop focused on clean skincare',
      tone: 'Premium',
      task: 'generate_names',
    });

    expect(result.businessNames).toEqual(['Glow Bar']);
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('wraps chain exhaustion in a stable error when every name-generation provider fails', async () => {
    mockGenerateObject.mockRejectedValue(new Error('model unavailable'));

    await expect(
      guideBusinessOnboarding({
        businessName: 'Starter',
        businessType: 'health-beauty',
        brandPreferences: 'pink',
        description: 'A beauty shop focused on clean skincare',
        tone: 'Premium',
        task: 'generate_names',
      })
    ).rejects.toThrow('Failed to generate business names.');
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('rejects color extraction without a logo URL', async () => {
    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Meds',
        businessType: 'pharmaceuticals',
        brandPreferences: 'green',
        task: 'extract_colors',
      })
    ).rejects.toThrow('logoUrl is required for color extraction.');
    expect(mockFetchImageBytes).not.toHaveBeenCalled();
  });

  it('rejects private or non-public logo URLs before fetching or invoking AI', async () => {
    mockIsPublicHttpUrl.mockResolvedValueOnce(false);

    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Meds',
        businessType: 'pharmaceuticals',
        brandPreferences: 'green',
        logoUrl: 'http://127.0.0.1/logo.png',
        task: 'extract_colors',
      })
    ).rejects.toThrow('Failed to extract brand colors.');

    expect(mockFetchImageBytes).not.toHaveBeenCalled();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('rejects invalid non-color strings returned by the vision chain during extract_colors', async () => {
    mockFetchImageBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        primary: 'not-a-valid-color',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    await expect(
      guideBusinessOnboarding({
        businessName: 'Baci Meds',
        businessType: 'pharmaceuticals',
        brandPreferences: 'green',
        logoUrl: 'https://example.com/logo.png',
        task: 'extract_colors',
      })
    ).rejects.toThrow('Failed to extract brand colors.');
  });

  it('keeps paid OpenAI disabled for the anonymous web server action even when OPENAI_API_KEY is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    mockGenerateOpenAiLogo.mockResolvedValue('data:image/png;base64,openai123');
    mockGenerateText.mockResolvedValueOnce({
      files: [{ mediaType: 'image/png', base64: 'gemini123' }],
    } as Awaited<ReturnType<typeof generateText>>);

    const logoResult = await guideBusinessOnboarding({
      businessName: 'Baci Style',
      businessType: 'fashion',
      brandPreferences: 'rose and gold',
      task: 'generate_logos',
    });

    expect(mockGenerateOpenAiLogo).not.toHaveBeenCalled();
    expect(logoResult.logos).toEqual(['data:image/png;base64,gemini123']);

    mockGenerateObject.mockResolvedValueOnce({
      object: { businessNames: ['Glow Bar'] },
    } as Awaited<ReturnType<typeof generateObject>>);

    const nameResult = await guideBusinessOnboarding({
      businessName: 'Starter',
      businessType: 'health-beauty',
      brandPreferences: 'pink',
      description: 'clean skincare shop',
      task: 'generate_names',
    });

    expect(nameResult.businessNames).toEqual(['Glow Bar']);
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-text-model' })
    );
  });

  it('uses OpenAI first when allowPaidOpenAi is enabled by an authenticated caller', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    mockGenerateOpenAiLogo.mockResolvedValueOnce(
      'data:image/png;base64,openai123'
    );

    const result = await runGuideBusinessOnboarding(
      {
        businessName: 'Baci Style',
        businessType: 'fashion',
        brandPreferences: 'rose and gold',
        task: 'generate_logos',
      },
      { allowPaidOpenAi: true }
    );

    expect(mockGenerateOpenAiLogo).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(result.logos).toEqual(['data:image/png;base64,openai123']);
  });
});
