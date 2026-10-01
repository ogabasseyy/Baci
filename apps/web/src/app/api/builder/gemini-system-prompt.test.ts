import {
  type BuilderDesignCapabilityManifest,
  builderDesignCapabilities,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { buildBuilderGeminiSystemPrompt } from './gemini-system-prompt';

describe('buildBuilderGeminiSystemPrompt', () => {
  it('relays manifest refusal codes and messages to the legacy provider prompt', () => {
    const prompt = buildBuilderGeminiSystemPrompt(builderDesignCapabilities);

    expect(prompt).toContain('CodeEmbed (unsafe-code)');
    expect(prompt).toContain(
      'Custom code is not available to AI because it can bypass storefront safety controls.'
    );
  });

  it('derives theme guidance from the supplied manifest tokens', () => {
    const manifest = structuredClone(
      builderDesignCapabilities
    ) as BuilderDesignCapabilityManifest;
    manifest.themeTokenKeys = ['primary', 'customTone'];

    expect(buildBuilderGeminiSystemPrompt(manifest)).toContain(
      'theme.colors.customTone'
    );
  });
});
