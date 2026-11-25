import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockImagesGenerate = vi.fn();
const mockOpenAiConstructor = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function MockOpenAI(options: unknown) {
    mockOpenAiConstructor(options);
    return {
      images: {
        generate: mockImagesGenerate,
      },
    };
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe('generateOpenAiLogo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when OPENAI_API_KEY is not configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { generateOpenAiLogo } = await import('./generate-openai-logo');

    const result = await generateOpenAiLogo('minimalist coffee logo');

    expect(result).toBeNull();
    expect(mockImagesGenerate).not.toHaveBeenCalled();
  });

  it('returns a PNG data URI when OpenAI generates a base64 image', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-1');
    mockImagesGenerate.mockResolvedValueOnce({
      data: [{ b64_json: 'iVBORw0KGgo=' }],
    });

    const { generateOpenAiLogo } = await import('./generate-openai-logo');
    const result = await generateOpenAiLogo('minimalist coffee logo');

    expect(result).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(mockOpenAiConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      timeout: 20_000,
      maxRetries: 0,
    });
    expect(mockImagesGenerate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'minimalist coffee logo',
      size: '1024x1024',
      n: 1,
    });
  });

  it('returns null on API error so callers fall back to Gemini', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    mockImagesGenerate.mockRejectedValueOnce(new Error('429 rate limited'));

    const { generateOpenAiLogo } = await import('./generate-openai-logo');
    const result = await generateOpenAiLogo('minimalist coffee logo');

    expect(result).toBeNull();
  });
});
