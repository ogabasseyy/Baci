import { expect, it } from 'vitest';
import {
  experienceError,
  experienceErrorCode,
  experienceFailure,
  experiencePerformanceBudgetError,
  experiencePerformanceBudgetResource,
  experiencePerformanceQualificationError,
  experiencePerformanceQualificationReason,
  experienceToolResult,
} from './experience-tool-results';

const message = 'Experience request unavailable.';
it('accepts object-valued JSON success envelopes and rejects malformed or extra fields', () => {
  const valid = {
    status: 'ok',
    value: { id: 'synthetic', nested: [null, true, 1, { next: 'cursor' }] },
  };
  expect(experienceToolResult.parse(valid)).toEqual(valid);
  for (const invalid of [
    { ...valid, secret: true },
    { status: 'ok' },
    { status: 'ok', value: [] },
    { status: 'ok', value: null },
    { status: 'ok', value: { invalid: undefined } },
    { status: 'unknown', value: {} },
  ])
    expect(experienceToolResult.safeParse(invalid).success).toBe(false);
  expect(experienceFailure.safeParse(valid).success).toBe(false);
});
it('validates every ordinary error code and keeps error details fixed', () => {
  for (const code of experienceErrorCode.options) {
    if (
      code === 'PERFORMANCE_BUDGET_EXCEEDED' ||
      code === 'PERFORMANCE_NOT_QUALIFIED'
    )
      continue;
    const failure = experienceError(code);
    expect(failure).toEqual({ status: 'error', code, error: message });
    expect(experienceFailure.parse(failure)).toEqual(failure);
    expect(experienceToolResult.parse(failure)).toEqual(failure);
  }
  for (const invalid of [
    { status: 'error', code: 'UNKNOWN', error: message },
    { status: 'error', code: 'NOT_FOUND', error: 'raw database details' },
    { status: 'error', code: 'NOT_FOUND' },
    { status: 'error', code: 'NOT_FOUND', error: message, secret: true },
    { status: 'error', code: 'NOT_FOUND', error: message, resource: 'css' },
  ])
    expect(experienceToolResult.safeParse(invalid).success).toBe(false);
});
it('requires a valid resource for budget failures and rejects qualification-only fields', () => {
  for (const resource of experiencePerformanceBudgetResource.options) {
    const failure = experiencePerformanceBudgetError(resource);
    expect(failure).toEqual({
      status: 'error',
      code: 'PERFORMANCE_BUDGET_EXCEEDED',
      resource,
      error: message,
    });
    expect(experienceToolResult.parse(failure)).toEqual(failure);
  }
  const base = {
    status: 'error',
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    error: message,
  };
  for (const invalid of [
    base,
    { ...base, resource: 'unknown' },
    { ...base, resource: 'css', reason: 'missing-metrics' },
  ]) {
    expect(experienceToolResult.safeParse(invalid).success).toBe(false);
  }
});
it('requires a valid reason for qualification failures and rejects budget-only fields', () => {
  for (const reason of experiencePerformanceQualificationReason.options) {
    const failure = experiencePerformanceQualificationError(reason);
    expect(failure).toEqual({
      status: 'error',
      code: 'PERFORMANCE_NOT_QUALIFIED',
      reason,
      error: message,
    });
    expect(experienceToolResult.parse(failure)).toEqual(failure);
  }
  const base = {
    status: 'error',
    code: 'PERFORMANCE_NOT_QUALIFIED',
    error: message,
  };
  for (const invalid of [
    base,
    { ...base, reason: 'unknown' },
    { ...base, reason: 'missing-metrics', resource: 'css' },
  ]) {
    expect(experienceToolResult.safeParse(invalid).success).toBe(false);
  }
});

it('projects only the fields used for MCP result assembly', async () => {
  const { experienceMcpResultEnvelope } = await import(
    './experience-tool-results'
  );
  expect(
    experienceMcpResultEnvelope.parse({
      status: 'error',
      code: 'INSUFFICIENT_SCOPE',
      error: message,
    })
  ).toEqual({ status: 'error', code: 'INSUFFICIENT_SCOPE' });
  expect(
    experienceMcpResultEnvelope.safeParse({ status: 'ok', value: [] }).success
  ).toBe(false);
  expect(
    experienceMcpResultEnvelope.safeParse({ status: 'unexpected' }).success
  ).toBe(false);
});
