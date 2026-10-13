import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiCapabilityPolicy } from './get-builder-ai-capability-policy';

describe('getBuilderAiCapabilityPolicy', () => {
  it('projects editable capabilities, refusal boundaries, and theme tokens', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    const codeEmbed = manifest.components.find(
      ({ componentType }) => componentType === 'CodeEmbed'
    );
    if (!codeEmbed?.refusal) throw new Error('Expected CodeEmbed refusal');
    codeEmbed.refusal.message = 'Manifest-controlled code boundary.';
    manifest.themeTokenKeys.push('surface');

    expect(getBuilderAiCapabilityPolicy(manifest)).toMatchObject({
      allowedComponentTypes: expect.arrayContaining(['Hero', 'Button']),
      refused: expect.arrayContaining([
        {
          code: 'unsafe-code',
          componentType: 'CodeEmbed',
          message: 'Manifest-controlled code boundary.',
        },
      ]),
      themeTokenKeys: expect.arrayContaining(['surface']),
    });
  });
});
