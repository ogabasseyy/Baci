import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  getOnboardingTextProviderChain,
  getTextProviderChain,
} from '@/ai/text-provider-chain';
import {
  extractBrandColorsFromDataUriBestEffort,
  extractBrandColorsFromUrl,
} from './extract-onboarding-brand-colors';
import { generateOpenAiLogo } from './generate-openai-logo';
import { runGuideBusinessOnboarding } from './guide-business-onboarding.core';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: vi.fn(),
}));

vi.mock('@/ai/provider', () => ({
  activeImageModel: 'gemini-image',
  sanitizePromptInput: (input: string, limit: number) => ({
    value: input.slice(0, limit),
  }),
  withRetry: vi.fn((operation: () => Promise<unknown>) => operation()),
}));

vi.mock('@/ai/text-provider-chain', () => ({
  getTextProviderChain: vi.fn(() => [{ name: 'google:gemini', model: 'g' }]),
  getOnboardingTextProviderChain: vi.fn(() => [
    { name: 'openai:gpt-5.4-mini', model: 'o' },
  ]),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./extract-onboarding-brand-colors', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./extract-onboarding-brand-colors')>();
  return {
    ...actual,
    extractBrandColorsFromUrl: vi.fn(),
    extractBrandColorsFromDataUriBestEffort: vi.fn(),
  };
});

vi.mock('./generate-openai-logo', () => ({
  generateOpenAiLogo: vi.fn(),
}));

describe('runGuideBusinessOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid input before invoking providers', async () => {
    await expect(
      runGuideBusinessOnboarding({
        businessName: 'a'.repeat(201),
        businessType: 'fashion',
        brandPreferences: 'minimal',
        task: 'generate_logos',
      })
    ).rejects.toThrow('Invalid onboarding input provided.');
    expect(generateOpenAiLogo).not.toHaveBeenCalled();
  });

  it('gates OpenAI logo and name chains behind allowPaidOpenAi', async () => {
    vi.mocked(generateOpenAiLogo).mockResolvedValueOnce(
      'data:image/png;base64,iVBORw0KGgo='
    );
    vi.mocked(extractBrandColorsFromDataUriBestEffort).mockResolvedValueOnce({
      primary: '#111111',
      background: '#FFFFFF',
      accent: '#F59E0B',
    });

    const logoResult = await runGuideBusinessOnboarding(
      {
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
        task: 'generate_logos',
      },
      { allowPaidOpenAi: true }
    );

    expect(logoResult.logos).toEqual(['data:image/png;base64,iVBORw0KGgo=']);
    expect(generateOpenAiLogo).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();

    vi.mocked(generateObjectWithChain).mockResolvedValueOnce({
      object: { businessNames: ['Kicks Hub'] },
      provider: 'google:gemini',
    } as never);

    await runGuideBusinessOnboarding({
      businessName: '',
      businessType: 'fashion',
      brandPreferences: 'modern',
      description: 'Sneakers in Lagos',
      task: 'generate_names',
    });

    expect(getTextProviderChain).toHaveBeenCalledTimes(1);
    expect(getOnboardingTextProviderChain).not.toHaveBeenCalled();
  });

  it('delegates extract_colors with the caller allowPaidOpenAi flag', async () => {
    vi.mocked(extractBrandColorsFromUrl).mockResolvedValueOnce({
      primary: '#1E293B',
      background: '#FFFFFF',
      accent: '#F59E0B',
    });

    const result = await runGuideBusinessOnboarding(
      {
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'modern',
        logoUrl: 'https://cdn.usebaci.com/logo.png',
        task: 'extract_colors',
      },
      { allowPaidOpenAi: true }
    );

    expect(extractBrandColorsFromUrl).toHaveBeenCalledWith(
      'https://cdn.usebaci.com/logo.png',
      true
    );
    expect(result.brandColors?.primary).toBe('#1E293B');
  });
});
