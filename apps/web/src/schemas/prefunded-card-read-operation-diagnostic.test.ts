import { expect, it } from 'vitest';
import { prefundedCardReadOperationDiagnosticSchemas as schemas } from './prefunded-card-read-operation-diagnostic';

it('accepts only the approved private path and no additional arguments', () => {
  expect(schemas.arguments.safeParse([schemas.pins.configPath]).success).toBe(
    true
  );
  for (const argumentsInput of [
    [],
    ['/tmp/config.json'],
    [schemas.pins.configPath, 'project'],
  ]) {
    expect(schemas.arguments.safeParse(argumentsInput).success).toBe(false);
  }
});

it('allows only redacted worker phase and code diagnostics', () => {
  const value = { profile: 'worker', phase: 'operation', code: '42501' };
  expect(schemas.diagnostic.safeParse(value).success).toBe(true);
  for (const invalid of [
    { ...value, profile: 'authorizer' },
    { ...value, phase: 'raw-secret' },
    { ...value, code: 'raw-secret' },
    { ...value, message: 'raw-secret' },
  ]) {
    expect(schemas.diagnostic.safeParse(invalid).success).toBe(false);
  }
});

it('never permits action, completion claims, or raw rows in a report', () => {
  const value = {
    status: 'read-operation-validated',
    redacted: true,
    financialActionAttempted: false,
    newPaymentStarted: false,
    acquiresRowLocks: true,
  };
  expect(schemas.report.safeParse(value).success).toBe(true);
  for (const invalid of [
    { ...value, financialActionAttempted: true },
    { ...value, newPaymentStarted: true },
    { ...value, financialCompleted: true },
    { ...value, rows: [] },
    { ...value, readOnlyTransaction: true },
  ]) {
    expect(schemas.report.safeParse(invalid).success).toBe(false);
  }
});
