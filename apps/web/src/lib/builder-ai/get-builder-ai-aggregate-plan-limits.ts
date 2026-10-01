import {
  MAX_AI_PLAN_INSERTS,
  MAX_AI_PLAN_OPERATIONS,
  MAX_AI_PLAN_SERIALIZED_UTF8_BYTES,
  MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS,
} from '@baci/shared/contracts';

export function getBuilderAiAggregatePlanLimits() {
  return {
    maxInserts: MAX_AI_PLAN_INSERTS,
    maxOperations: MAX_AI_PLAN_OPERATIONS,
    maxSerializedUtf8Bytes: MAX_AI_PLAN_SERIALIZED_UTF8_BYTES,
    maxSummaryOrRefusalReasonChars: MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS,
  };
}
