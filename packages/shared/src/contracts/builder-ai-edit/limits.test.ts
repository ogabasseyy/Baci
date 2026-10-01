import { describe, expect, it } from 'vitest';
import {
  MAX_AI_EDIT_BODY_BYTES,
  MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS,
  MAX_BUILDER_ARRAY_ITEMS,
  MAX_BUILDER_BLOCKS,
  MAX_BUILDER_ZONE_KEYS,
} from './limits';

describe('builder AI edit limits', () => {
  it('keeps top-level document and nested collection budgets distinct', () => {
    expect(MAX_AI_EDIT_BODY_BYTES).toBe(1_048_576);
    expect(MAX_BUILDER_BLOCKS).toBe(500);
    expect(MAX_BUILDER_ZONE_KEYS).toBe(100);
    expect(MAX_BUILDER_ARRAY_ITEMS).toBe(100);
    expect(MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS).toBe(240);
  });
});
