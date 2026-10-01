import { describe, expect, it } from 'vitest';
import { aiEditableComponents } from './builder-ai-component-definitions';

describe('aiEditableComponents', () => {
  it('defines safe defaults for insertable components and no defaults for protected blocks', () => {
    expect(aiEditableComponents.Hero.defaults).toMatchObject({
      ctaLink: '/products',
    });
    expect(aiEditableComponents.Header).not.toHaveProperty('defaults');
  });
});
