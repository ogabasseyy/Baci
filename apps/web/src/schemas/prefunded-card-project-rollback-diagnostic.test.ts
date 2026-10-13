import { expect, it } from 'vitest';
import { prefundedCardProjectRollbackDiagnosticSchemas as schemas } from './prefunded-card-project-rollback-diagnostic';

it('pins operation, system, private path and expiry without dynamic financial inputs', () => {
  expect(schemas.pins).toMatchObject({
    operationId: 'ff561046-58e7-428d-9163-f6e60b0dab65',
    systemIdentifier: '7685292944002592802',
    deadline: '2026-10-06T15:59:10Z',
  });
  expect(
    schemas.arguments.safeParse([schemas.pins.configPath, 'project']).success
  ).toBe(false);
  expect(
    Object.values(schemas.settings).some((value: unknown) => value === 'COMMIT')
  ).toBe(false);
});

it('requires confirmed rollback and closed connection for every successful outcome', () => {
  const report = {
    status: 'project-rollback-validated',
    redacted: true,
    financialCommitted: false,
    newPaymentStarted: false,
    outcome: 'applied',
    constraintsValidated: true,
    rollbackConfirmed: true,
    connectionClosed: true,
  };
  expect(schemas.report.safeParse(report).success).toBe(true);
  for (const invalid of [
    { ...report, constraintsValidated: false },
    { ...report, rollbackConfirmed: false },
    { ...report, connectionClosed: false },
    { ...report, financialCommitted: true },
    { ...report, outcome: 'other' },
    { ...report, raw: 'secret' },
  ])
    expect(schemas.report.safeParse(invalid).success).toBe(false);
});

it('allows only fixed redacted diagnostic phase and code', () => {
  const report = {
    status: 'project-rollback-refused',
    redacted: true,
    financialCommitted: false,
    newPaymentStarted: false,
    constraintsValidated: false,
    rollbackConfirmed: false,
    connectionClosed: true,
    diagnostic: { profile: 'worker', phase: 'operation', code: '42501' },
  };
  expect(schemas.report.safeParse(report).success).toBe(true);
  expect(
    schemas.report.safeParse({
      ...report,
      diagnostic: { ...report.diagnostic, code: 'secret' },
    }).success
  ).toBe(false);
  expect(
    schemas.report.safeParse({
      ...report,
      diagnostic: { ...report.diagnostic, message: 'secret' },
    }).success
  ).toBe(false);
});
