import { describe, expect, it } from 'vitest';
import { restoreNativePreviewPlaceholders } from './native-preview-placeholder-input';

describe('native placeholder input', () => {
  it('restores known inert placeholders in content and zones for the existing projector', () => {
    const placeholder = {
      type: 'PreviewPlaceholder',
      props: { id: 'code-1', label: 'CodeEmbed section' },
    };
    expect(
      restoreNativePreviewPlaceholders({
        content: [placeholder],
        zones: { 'row:slot': [placeholder] },
      })
    ).toEqual({
      content: [{ type: 'CodeEmbed', props: { id: 'code-1' } }],
      zones: { 'row:slot': [{ type: 'CodeEmbed', props: { id: 'code-1' } }] },
    });
  });
  it.each([
    { type: 'PreviewPlaceholder', props: { id: 'a', label: 'Text section' } },
    {
      type: 'PreviewPlaceholder',
      props: { id: 'a', label: 'CodeEmbed section', code: 'unsafe' },
    },
    {
      type: 'PreviewPlaceholder',
      props: { id: 'a', label: 'CodeEmbed section' },
      extra: true,
    },
  ])('leaves invalid placeholders for the schema to reject', (invalid) => {
    expect(restoreNativePreviewPlaceholders({ content: [invalid] })).toEqual({
      content: [invalid],
    });
  });
});
