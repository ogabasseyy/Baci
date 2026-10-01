import { describe, expect, it } from 'vitest';
import { pushBuilderAiWarnings } from './push-builder-ai-warnings';

describe('pushBuilderAiWarnings', () => {
  it('bounds warning count and individual warning length', () => {
    const warnings: string[] = [];

    pushBuilderAiWarnings(warnings, [
      ...Array.from({ length: 11 }, () => 'warning'),
      'x'.repeat(200),
    ]);

    expect(warnings).toHaveLength(10);
    expect(warnings[0]).toBe('warning');
  });
});
