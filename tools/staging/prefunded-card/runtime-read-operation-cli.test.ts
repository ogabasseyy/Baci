import { beforeEach, expect, it, vi } from 'vitest';
import { buildPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config';
import { createActivationConfigFixture } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config.test-support';
import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';
import { createPrefundedCardPostgresExecutor } from '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-executor';
import { prefundedCardReadOperationDiagnosticSchemas as schemas } from '../../../apps/web/src/schemas/prefunded-card-read-operation-diagnostic';

vi.mock('server-only', () => ({}));
vi.mock(
  '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file'
);
vi.mock('../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-executor');

const execute = vi.fn();
const statement =
  'SELECT prefunded_card.read_operation($1::uuid,$2::text) AS result';
const row = {
  operationId: schemas.pins.operationId,
  collectionStatus: 'verified_success',
  transferStatus: 'verified_success',
  projectionStatus: 'unapplied',
  collectionFence: 0,
  transferFence: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  const source = createActivationConfigFixture();
  const loaded = buildPrefundedCardActivationConfig(
    source,
    new Date('2026-09-27T12:00:00Z')
  );
  if (!loaded.ok) throw new Error('Synthetic configuration invalid');
  vi.mocked(readPrefundedCardActivationConfig).mockResolvedValue({
    ...loaded,
    source,
  });
  vi.mocked(createPrefundedCardPostgresExecutor).mockReturnValue(execute);
  execute.mockResolvedValue({ rows: [{ result: { ...row } }] });
});

async function run(
  argumentsInput: readonly string[] = [schemas.pins.configPath]
) {
  const { runPrefundedCardReadOperationCli } = await import(
    './runtime-read-operation-cli'
  );
  const output: string[] = [];
  const exitCode = await runPrefundedCardReadOperationCli({
    arguments: argumentsInput,
    writeLine: (line) => output.push(line),
  });
  expect(output).toHaveLength(1);
  const report: unknown = JSON.parse(output[0]);
  expect(schemas.report.safeParse(report).success).toBe(true);
  expect(output[0]).not.toContain('synthetic-test-only');
  return { exitCode, report, output: output[0] };
}

it('isolates import and observes side effects before any subsequent mock reset', async () => {
  vi.resetModules();
  const originalExitCode = process.exitCode;
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  try {
    await import('./runtime-read-operation-cli');
    expect(readPrefundedCardActivationConfig).not.toHaveBeenCalled();
    expect(createPrefundedCardPostgresExecutor).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  } finally {
    output.mockRestore();
    process.exitCode = originalExitCode;
  }
});

it('uses the TLS worker profile and exactly one fixed read without projection or claims', async () => {
  const result = await run();
  expect(result.exitCode).toBe(0);
  expect(result.report).toEqual({
    status: 'read-operation-validated',
    redacted: true,
    financialActionAttempted: false,
    newPaymentStarted: false,
    acquiresRowLocks: true,
  });
  expect(readPrefundedCardActivationConfig).toHaveBeenCalledExactlyOnceWith(
    schemas.pins.configPath
  );
  expect(createPrefundedCardPostgresExecutor).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      profile: 'worker',
      transport: 'tls',
      login: schemas.pins.login,
      expectedSystemId: schemas.pins.systemIdentifier,
    })
  );
  expect(execute).toHaveBeenCalledExactlyOnceWith(statement, [
    schemas.pins.operationId,
    schemas.pins.systemIdentifier,
  ]);
  expect(result.output).not.toContain('collectionFence');
});

it.each([
  [],
  ['/tmp/config.json'],
  [schemas.pins.configPath, 'project'],
])('rejects unapproved arguments before reading configuration: %j', async (...argumentsInput) => {
  const result = await run(argumentsInput);
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'arguments' });
  expect(readPrefundedCardActivationConfig).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it('refuses a missing or invalid private file before creating an executor', async () => {
  vi.mocked(readPrefundedCardActivationConfig).mockResolvedValue({
    ok: false,
    issues: [],
  });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'configuration' });
  expect(createPrefundedCardPostgresExecutor).not.toHaveBeenCalled();
});

it.each([
  { login: 'prefunded_authorizer' },
  { expectedLogin: 'prefunded_authorizer' },
  { expectedSystemId: '7686901100561231906' },
  { transport: 'local_test' },
])('refuses mismatched execution authority without SQL: %j', async (change) => {
  const source = createActivationConfigFixture();
  const loaded = buildPrefundedCardActivationConfig(
    source,
    new Date('2026-09-27T12:00:00Z')
  );
  if (!loaded.ok) throw new Error('Synthetic configuration invalid');
  Object.assign(loaded.configuration.background.database.treasury, change);
  vi.mocked(readPrefundedCardActivationConfig).mockResolvedValue({
    ...loaded,
    source,
  });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'configuration' });
  expect(createPrefundedCardPostgresExecutor).not.toHaveBeenCalled();
});

it('redacts private file exceptions without executing SQL', async () => {
  vi.mocked(readPrefundedCardActivationConfig).mockRejectedValue(
    new Error('synthetic-test-only')
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'configuration' });
  expect(execute).not.toHaveBeenCalled();
});

it('retains initialization diagnostics without executing SQL', async () => {
  const { PrefundedCardPostgresFailure } = await import(
    '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure'
  );
  vi.mocked(createPrefundedCardPostgresExecutor).mockImplementation(() => {
    throw new PrefundedCardPostgresFailure('worker', 'configuration');
  });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    diagnostic: { phase: 'configuration', code: 'unclassified' },
  });
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  'connect',
  'session-validation',
  'result-validation',
  'commit',
  'commit-validation',
] as const)('retains safe executor diagnostics on exit1 at %s', async (phase) => {
  const { PrefundedCardPostgresFailure } = await import(
    '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure'
  );
  execute.mockRejectedValue(
    new PrefundedCardPostgresFailure(
      'worker',
      phase,
      Object.assign(new Error('synthetic-test-only'), { code: '42501' })
    )
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    stage: 'executor',
    diagnostic: { profile: 'worker', phase, code: '42501' },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('redacts unknown thrown errors and never retries', async () => {
  execute.mockRejectedValue(
    Object.assign(new Error('synthetic-test-only'), { code: 'secret-code' })
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'executor' });
  expect(result.output).not.toContain('secret-code');
  expect(result.output).not.toContain('diagnostic');
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each([
  { ...row, operationId: '10000000-0000-4000-8000-000000000001' },
  { ...row, collectionFence: '0' },
  { ...row, transferFence: Number.MAX_SAFE_INTEGER + 1 },
  { ...row, transferFence: -1 },
  { ...row, extra: 'synthetic-test-only' },
])('rejects malformed or mismatched read rows without another SQL call: %j', async (resultRow) => {
  execute.mockResolvedValue({ rows: [{ result: resultRow }] });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ stage: 'read-result' });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('emits refusal JSON before returning the failing exit code', async () => {
  const { runPrefundedCardReadOperationCli } = await import(
    './runtime-read-operation-cli'
  );
  const { PrefundedCardPostgresFailure } = await import(
    '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure'
  );
  const events: string[] = [];
  execute.mockRejectedValue(
    new PrefundedCardPostgresFailure('worker', 'operation')
  );
  const exitCode = await runPrefundedCardReadOperationCli({
    arguments: [schemas.pins.configPath],
    writeLine: () => events.push('output'),
  });
  events.push(`exit:${exitCode}`);
  expect(events).toEqual(['output', 'exit:1']);
});
