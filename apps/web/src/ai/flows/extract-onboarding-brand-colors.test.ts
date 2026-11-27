import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  getOnboardingVisionProviderChain,
  getVisionProviderChain,
} from '@/ai/vision-provider-chain';
import { fetchImageBytes } from '@/lib/fetch-image-bytes';
import { isPublicHttpUrl } from '@/lib/is-public-http-url';
import {
  extractBrandColorsFromDataUriBestEffort,
  extractBrandColorsFromUrl,
} from './extract-onboarding-brand-colors';

vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: vi.fn(),
}));

vi.mock('@/ai/vision-provider-chain', () => ({
  getVisionProviderChain: vi.fn(() => [{ name: 'google:gemini', model: 'g' }]),
  getOnboardingVisionProviderChain: vi.fn(() => [
    { name: 'openai:gpt-5.4-mini', model: 'o' },
  ]),
}));

vi.mock('@/lib/fetch-image-bytes', () => ({
  fetchImageBytes: vi.fn(),
}));

vi.mock('@/lib/is-public-http-url', () => ({
  isPublicHttpUrl: vi.fn(async () => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('extract-onboarding-brand-colors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPublicHttpUrl).mockResolvedValue(true);
  });

  it('extracts validated brand colors from a public URL using the onboarding vision chain when allowPaidOpenAi is true', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
    vi.mocked(generateObjectWithChain).mockResolvedValueOnce({
      object: { primary: '#1E293B', background: '#FFFFFF', accent: '#F59E0B' },
      provider: 'openai:gpt-5.4-mini',
    } as never);

    const colors = await extractBrandColorsFromUrl(
      'https://cdn.usebaci.com/logo.png',
      true
    );

    expect(colors).toEqual({
      primary: '#1E293B',
      background: '#FFFFFF',
      accent: '#F59E0B',
    });
    expect(getOnboardingVisionProviderChain).toHaveBeenCalledTimes(1);
    expect(getVisionProviderChain).not.toHaveBeenCalled();
  });

  it('fails closed when URL is non-public or guarded fetch returns null', async () => {
    vi.mocked(isPublicHttpUrl).mockResolvedValueOnce(false);
    await expect(
      extractBrandColorsFromUrl('http://127.0.0.1/logo.png')
    ).rejects.toThrow('Failed to extract brand colors.');

    vi.mocked(fetchImageBytes).mockResolvedValueOnce(null);
    await expect(
      extractBrandColorsFromUrl('https://cdn.usebaci.com/logo.png')
    ).rejects.toThrow('Failed to extract brand colors.');
    expect(generateObjectWithChain).not.toHaveBeenCalled();
  });

  it('falls back to deterministic colors when data-URI extraction gets invalid colors or < 1s budget', async () => {
    const tightBudget = await extractBrandColorsFromDataUriBestEffort(
      'data:image/png;base64,iVBORw0KGgo=',
      'Kicks Hub',
      'fashion',
      500
    );
    expect(tightBudget.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(generateObjectWithChain).not.toHaveBeenCalled();

    vi.mocked(generateObjectWithChain).mockResolvedValueOnce({
      object: { primary: 'invalid', background: '#FFFFFF', accent: '#F59E0B' },
      provider: 'google:gemini',
    } as never);
    const invalidFallback = await extractBrandColorsFromDataUriBestEffort(
      'data:image/png;base64,iVBORw0KGgo=',
      'Kicks Hub',
      'fashion',
      5_000
    );
    expect(invalidFallback.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
