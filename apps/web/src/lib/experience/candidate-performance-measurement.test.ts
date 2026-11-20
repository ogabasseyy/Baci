import { expect, it, vi } from 'vitest';
import {
  makeInput,
  output,
  routeBootstrap,
} from './candidate-performance-fixture.test-support';
import { measureCandidatePerformance } from './candidate-performance-measurement';

it('measures each declared route family at both widths for three cold samples', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result.status).toBe('measured');
  expect(result.report?.samples).toHaveLength(12);
  expect(result.report?.samples[0]?.diagnostics?.frame.rawCls).toBe(0.08);
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(12);
  expect(result.qualification).toMatchObject({
    routeCount: 2,
    sampleCount: 12,
  });
  expect(result.report?.cwvQualified).toBe(false);
  expect(result.report?.releaseQualified).toBe(false);
});

it('retains a contaminated worker sample as failed diagnostic evidence and stops early', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input, { contaminated: true }),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result.status).toBe('failed');
  expect(result.report?.contaminated).toBe(true);
  expect(result.report?.samples).toHaveLength(1);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('returns not-measured for malformed or wrongly bound worker output', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input, { buildDigest: 'f'.repeat(64) }),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result).toEqual({
    status: 'not-measured',
    report: undefined,
    qualification: undefined,
    jobIds: ['job-performance'],
  });
});

it('does not start a browser when the local host CPU is contaminated', async () => {
  const execute = vi.fn();
  const input = makeInput(execute);
  input.hostContaminated = () => true;
  const result = await measureCandidatePerformance(input as never);
  expect(result.status).toBe('not-measured');
  expect(execute).not.toHaveBeenCalled();
});

it('does not invent a product route when its public bootstrap omits that product', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input),
  }));
  const input = makeInput(execute);
  input.bootstrap.mockImplementation(async (view) => ({
    ...routeBootstrap(view),
    ...(view === 'product'
      ? { catalog: { products: [], revision: 'revision' } }
      : {}),
  }));
  const result = await measureCandidatePerformance(input as never);
  expect(result.status).toBe('not-measured');
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(6);
});

it('enforces the SSR HTML byte budget on every representative route', async () => {
  const execute = vi.fn(async (kind: string, payload: unknown) => ({
    jobId: `job-${kind}`,
    output:
      kind === 'prerender'
        ? {
            format: 'baci-prerender/v1',
            html:
              (payload as { bootstrap: { route: { canonicalPath: string } } })
                .bootstrap.route.canonicalPath === '/'
                ? '<main>home</main>'
                : 'x'.repeat(128 * 1024 + 1),
          }
        : output(payload),
  }));
  const input = makeInput(execute);
  input.rendererKind = 'prerender';
  await expect(
    measureCandidatePerformance(input as never)
  ).rejects.toMatchObject({
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource: 'ssr-html',
  });
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'prerender')
  ).toHaveLength(2);
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(6);
});

it('propagates owner authorization failures from route bootstrap', async () => {
  const input = makeInput(vi.fn());
  input.bootstrap.mockRejectedValueOnce(Error('NOT_FOUND'));
  await expect(measureCandidatePerformance(input as never)).rejects.toThrow(
    'NOT_FOUND'
  );
});

it('reports not-measured when a new store has no representative product', async () => {
  const input = makeInput(vi.fn());
  input.bootstrap.mockRejectedValueOnce(Error('NO_REPRESENTATIVE_PRODUCT'));
  await expect(
    measureCandidatePerformance(input as never)
  ).resolves.toMatchObject({
    status: 'not-measured',
    report: undefined,
  });
});
