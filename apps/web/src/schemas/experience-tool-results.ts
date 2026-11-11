import { z } from 'zod';
export const experienceErrorCode = z.enum([
  'INVALID_REQUEST',
  'NOT_FOUND',
  'INSUFFICIENT_SCOPE',
  'CONNECTION_REVOKED',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'STALE_VERSION',
  'STALE_SOURCE',
  'APPROVAL_EXPIRED',
  'APPROVAL_MISMATCH',
  'PREVIEW_REQUIRED',
  'INCOMPATIBLE_POLICY',
  'OUTPUT_NOT_RETAINED',
  'ASSET_NOT_RETAINED',
  'ROLLBACK_NOT_RETAINED',
  'COMPATIBLE_LEGACY_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'BUILD_FAILED',
  'QUOTA_EXCEEDED',
  'PERFORMANCE_BUDGET_EXCEEDED',
  'PERFORMANCE_NOT_QUALIFIED',
]);
export const experiencePerformanceBudgetResource = z.enum([
  'javascript',
  'css',
  'ssr-html',
  'png-asset',
  'font-asset',
]);
export const experiencePerformanceQualificationReason = z.enum([
  'invalid-report',
  'binding-mismatch',
  'data-binding-mismatch',
  'renderer-mismatch',
  'contaminated',
  'route-matrix-mismatch',
  'missing-metrics',
  'content-not-ready',
  'lcp-threshold',
  'cls-threshold',
]);
export const experienceFailure = z.union([
  z.strictObject({
    status: z.literal('error'),
    code: experienceErrorCode.exclude([
      'PERFORMANCE_BUDGET_EXCEEDED',
      'PERFORMANCE_NOT_QUALIFIED',
    ]),
    error: z.literal('Experience request unavailable.'),
  }),
  z.strictObject({
    status: z.literal('error'),
    code: z.literal('PERFORMANCE_BUDGET_EXCEEDED'),
    resource: experiencePerformanceBudgetResource,
    error: z.literal('Experience request unavailable.'),
  }),
  z.strictObject({
    status: z.literal('error'),
    code: z.literal('PERFORMANCE_NOT_QUALIFIED'),
    reason: experiencePerformanceQualificationReason,
    error: z.literal('Experience request unavailable.'),
  }),
]);
export const experienceToolResult = z.union([
  z.strictObject({
    status: z.literal('ok'),
    value: z.record(z.string(), z.json()),
  }),
  experienceFailure,
]);
export type ExperienceToolResult = z.infer<typeof experienceToolResult>;
export function experienceError(
  code: Exclude<
    z.infer<typeof experienceErrorCode>,
    'PERFORMANCE_BUDGET_EXCEEDED' | 'PERFORMANCE_NOT_QUALIFIED'
  >
): ExperienceToolResult {
  return { status: 'error', code, error: 'Experience request unavailable.' };
}
export function experiencePerformanceBudgetError(
  resource: z.infer<typeof experiencePerformanceBudgetResource>
): ExperienceToolResult {
  return {
    status: 'error',
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource,
    error: 'Experience request unavailable.',
  };
}
export function experiencePerformanceQualificationError(
  reason: z.infer<typeof experiencePerformanceQualificationReason>
): ExperienceToolResult {
  return {
    status: 'error',
    code: 'PERFORMANCE_NOT_QUALIFIED',
    reason,
    error: 'Experience request unavailable.',
  };
}

/** Narrow projection for MCP assembly after validating the wire result. */
export const experienceMcpResultEnvelope = z.object({
  status: z.enum(['ok', 'error']),
  value: z.record(z.string(), z.unknown()).optional(),
  code: z.string().optional(),
});
