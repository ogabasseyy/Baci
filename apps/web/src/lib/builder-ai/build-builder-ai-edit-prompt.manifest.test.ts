import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { buildBuilderAiEditPrompt } from './build-builder-ai-edit-prompt';

describe('buildBuilderAiEditPrompt manifest policy', () => {
  it('derives provider refusal boundaries and theme tokens from the manifest', () => {
    const refused = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'CodeEmbed'
    );
    if (!refused?.refusal) throw new Error('Expected CodeEmbed refusal');
    const originalMessage = refused.refusal.message;
    const originalTokens = [...builderDesignCapabilities.themeTokenKeys];
    try {
      refused.refusal.message = 'Manifest-controlled code boundary.';
      builderDesignCapabilities.themeTokenKeys.push('surface');
      const prompt = buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Add custom code and change the theme',
      });
      const guide = JSON.parse(
        prompt.match(/<operation-guide>(.+)<\/operation-guide>/)?.[1] ?? ''
      ) as {
        capabilityPolicy: {
          refused: Array<{ componentType: string; message: string }>;
          themeTokenKeys: string[];
        };
        updateThemeOperation: { colors: { allowedKeys: string[] } };
      };
      expect(guide.capabilityPolicy.refused).toContainEqual({
        code: 'unsafe-code',
        componentType: 'CodeEmbed',
        message: 'Manifest-controlled code boundary.',
      });
      expect(guide.capabilityPolicy.themeTokenKeys).toContain('surface');
      expect(guide.updateThemeOperation.colors.allowedKeys).toContain(
        'surface'
      );
    } finally {
      refused.refusal.message = originalMessage;
      builderDesignCapabilities.themeTokenKeys.splice(
        0,
        builderDesignCapabilities.themeTokenKeys.length,
        ...originalTokens
      );
    }
  });
});
