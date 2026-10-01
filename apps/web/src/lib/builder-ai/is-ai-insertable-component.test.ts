import { describe, expect, it } from 'vitest';
import { isAiInsertableComponent } from './is-ai-insertable-component';

describe('isAiInsertableComponent', () => {
  it('allows content blocks but rejects protected and unknown types', () => {
    expect(isAiInsertableComponent('Text')).toBe(true);
    expect(isAiInsertableComponent('Header')).toBe(false);
    expect(isAiInsertableComponent('Image')).toBe(false);
  });
});
