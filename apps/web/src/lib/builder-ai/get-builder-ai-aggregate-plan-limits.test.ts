import { describe, expect, it } from 'vitest';
import { getBuilderAiAggregatePlanLimits } from './get-builder-ai-aggregate-plan-limits';

describe('getBuilderAiAggregatePlanLimits', () => {
  it('returns the locally enforced model-plan aggregate bounds', () => {
    expect(getBuilderAiAggregatePlanLimits()).toEqual({
      maxInserts: 5,
      maxOperations: 20,
      maxSerializedUtf8Bytes: 4096,
      maxSummaryOrRefusalReasonChars: 240,
    });
  });
});
