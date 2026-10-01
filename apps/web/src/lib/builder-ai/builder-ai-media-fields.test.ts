import { describe, expect, it } from 'vitest';
import { isBuilderAiMediaField } from './builder-ai-media-fields';

describe('isBuilderAiMediaField', () => {
  it('recognizes media and source fields without treating copy as media', () => {
    expect(isBuilderAiMediaField('source')).toBe(true);
    expect(isBuilderAiMediaField('src')).toBe(true);
    expect(isBuilderAiMediaField('title')).toBe(false);
  });
});
