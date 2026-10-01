import { describe, expect, it } from 'vitest';
import { getAiComponentDefinition } from './get-ai-component-definition';

describe('getAiComponentDefinition', () => {
  it('returns the catalog definition for an allowlisted type', () => {
    expect(getAiComponentDefinition('Hero').editableProps).toContain('title');
  });
});
