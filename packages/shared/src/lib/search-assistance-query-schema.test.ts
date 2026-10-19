import { describe, expect, it } from 'vitest';
import { searchAssistanceQuerySchema } from './search-assistance-query-schema';

describe('searchAssistanceQuerySchema', () => {
  it('bounds the shared query rule at 2–120 trimmed chars plus a catalog term', () => {
    expect(searchAssistanceQuerySchema.safeParse('ab').success).toBe(true);
    expect(searchAssistanceQuerySchema.safeParse('a'.repeat(120)).success).toBe(
      true
    );
    expect(searchAssistanceQuerySchema.safeParse('a').success).toBe(false);
    expect(searchAssistanceQuerySchema.safeParse('a'.repeat(121)).success).toBe(
      false
    );
    expect(searchAssistanceQuerySchema.safeParse('!!').success).toBe(false);
    expect(searchAssistanceQuerySchema.safeParse('  ab  ').success).toBe(true);
  });
});
