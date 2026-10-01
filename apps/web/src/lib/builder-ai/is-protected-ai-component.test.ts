import { describe, expect, it } from 'vitest';
import { isProtectedAiComponent } from './is-protected-ai-component';

describe('isProtectedAiComponent', () => {
  it('identifies protected layout blocks without protecting content blocks', () => {
    expect(isProtectedAiComponent('Footer')).toBe(true);
    expect(isProtectedAiComponent('Hero')).toBe(false);
  });
});
