import { describe, expect, it } from 'vitest';
import { isAiEditableComponent } from './is-ai-editable-component';

describe('isAiEditableComponent', () => {
  it('accepts catalog components and rejects unsupported blocks', () => {
    expect(isAiEditableComponent('Hero')).toBe(true);
    expect(isAiEditableComponent('Image')).toBe(false);
  });
});
