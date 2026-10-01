import { describe, expect, it } from 'vitest';
import { sanitizeBuilderAiProps } from './sanitize-builder-ai-props';

describe('sanitizeBuilderAiProps', () => {
  it('retains safe editable props while refusing media, unsafe links, and unknown fields', () => {
    expect(
      sanitizeBuilderAiProps('Hero', {
        backgroundImage: 'https://cdn.example.test/hero.png',
        ctaLink: 'javascript:alert(1)',
        title: 'Safe title',
        unknown: 'discard',
      })
    ).toEqual({
      props: { title: 'Safe title' },
      warnings: [
        'Media changes require Baci manual asset controls.',
        'Ignored unsafe Hero URL.',
        'Ignored unsupported Hero fields.',
      ],
    });
  });
});
