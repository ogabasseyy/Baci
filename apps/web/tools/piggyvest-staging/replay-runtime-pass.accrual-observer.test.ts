// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { readProtectedReplayFile } from './replay-protected-file';

const state = vi.hoisted(() => ({
  read: vi.fn<typeof readProtectedReplayFile>(),
  factory: vi.fn(),
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock('./replay-protected-file', () => ({
  readProtectedReplayFile: state.read,
}));
vi.mock('./replay-prefunded-loader', async (original) => {
  const actual = await original<typeof import('./replay-prefunded-loader')>();
  return {
    loadPrefundedReplay: (
      input: Parameters<typeof actual.loadPrefundedReplay>[0]
    ) =>
      actual.loadPrefundedReplay(input, {
        read: state.read,
        importModule: async () => ({
          createPrefundedCardReplayRuntime: state.factory,
        }),
        fetchImplementation: fetch,
      }),
  };
});
vi.mock('pg', () => ({
  Client: class {
    private readOnly = false;
    constructor(private readonly configuration: { user: string }) {
      state.construct(configuration);
    }
    connect() {
      return state.connect(this.configuration.user);
    }
    query(statement: string, parameters?: unknown[]) {
      if (statement.startsWith('BEGIN'))
        this.readOnly = statement === 'BEGIN READ ONLY';
      return state.query(
        this.configuration.user,
        statement,
        parameters,
        this.readOnly
      );
    }
    end = state.end;
    on() {
      return this;
    }
  },
}));

import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { accrualObserverQueryResponse } from './replay-accrual-observer-query.test-support';
import { runConfiguredReplayPass } from './replay-runtime-pass';

let sample: ReturnType<typeof createAccrualObserverTestFixture>;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let failure: string;
let signature: string | null;
const observations = new Set<string>();
const paid = new Set<string>();
const native = vi.fn();
const wrapper =
  'SELECT piggyvest_staging.record_interest_accrual_scoped($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::json) AS result';

beforeEach(() => {
  // Observer schemas pin a fixed execution deadline with a Date.now()
  // expiry refine: freeze before it so happy-path tests stay green
  // regardless of wall-clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:00Z'));
  vi.clearAllMocks();
  observations.clear();
  paid.clear();
  sample = createAccrualObserverTestFixture();
  failure = '';
  signature = sample.signature;
  state.end.mockResolvedValue(undefined);
  state.connect.mockImplementation(async (role: string) => {
    if (role === 'piggyvest_staging_ledger_worker' && failure === 'transport')
      throw new Error('private transport error');
  });
  state.read.mockImplementation(async ({ path }) =>
    path.endsWith('.json') ? sample.privateBytes : sample.bundle
  );
  state.query.mockImplementation(
    async (
      role: string,
      sql: string,
      parameters?: string[],
      readOnly = false
    ) =>
      accrualObserverQueryResponse({
        sample,
        role,
        sql,
        parameters,
        readOnly,
        failure,
        observations,
        paid,
      })
  );
  native.mockImplementation(
    async ({ rawPayload }: { rawPayload: Uint8Array }) => {
      const event = JSON.parse(Buffer.from(rawPayload).toString()) as {
        eventType: string;
      };
      return {
        outcome: 'processed',
        projection:
          event.eventType === 'bank-transfer.inflow.success'
            ? 'applied'
            : 'not_applicable',
      };
    }
  );
  state.factory.mockResolvedValue({
    resolveEnrollment: async () => 'enrolled',
    replay: native,
  });
  transport = vi.fn<typeof fetch>(async (input) => {
    const request = new Request(input);
    const rpc = new URL(request.url).pathname.split('/').at(-1);
    const body: Record<string, unknown> = await request.json();
    if (rpc === 'piggyvest_staging_system_id')
      return Response.json(
        request.url.includes('receipts-rest')
          ? sample.configuration.receiptSystemId
          : sample.configuration.appSystemId
      );
    if (rpc === 'claim_piggyvest_staging_receipts')
      return Response.json(sample.rows);
    if (rpc === 'read_piggyvest_staging_receipt_signature')
      return Response.json(
        signature === null
          ? null
          : {
              receiptId: body.p_receipt_id,
              payloadSha256: body.p_payload_sha256,
              signature,
            }
      );
    if (rpc === 'resolve_piggyvest_staging_receipt') return Response.json(true);
    if (rpc === 'quarantine_piggyvest_staging_receipt')
      return Response.json(true);
    throw new Error('Unexpected mocked RPC');
  });
  vi.stubGlobal('fetch', transport);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('handles native bank/outflow, paid interest and authentic fractional accrual through one claimant', async () => {
  await runConfiguredReplayPass(sample.configuration);
  const requests = transport.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input)
  );
  expect(
    requests.filter((url) => url.endsWith('/claim_piggyvest_staging_receipts'))
  ).toHaveLength(1);
  expect(
    requests.filter((url) => url.endsWith('/resolve_piggyvest_staging_receipt'))
  ).toHaveLength(4);
  expect(native).toHaveBeenCalledTimes(2);
  expect(paid.size).toBe(1);
  expect(observations.size).toBe(1);
  const write = state.query.mock.calls.find(([, sql]) => sql === wrapper);
  expect(write).toEqual([
    'piggyvest_staging_ledger_worker',
    wrapper,
    [
      sample.scope.integrationId,
      sample.scope.businessId,
      sample.configuration.appSystemId,
      sample.rows[3].receipt_id,
      sample.rows[3].payload_sha256,
      sample.raw.toString('utf8'),
    ],
    false,
  ]);
  const preflight = state.query.mock.calls.findIndex(
    ([role, sql]) =>
      role === 'piggyvest_staging_ledger_worker' &&
      sql.includes('has_function_privilege')
  );
  expect(state.query.mock.invocationCallOrder[preflight]).toBeLessThan(
    transport.mock.invocationCallOrder[0]
  );
  expect(state.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      user: 'piggyvest_staging_ledger_worker',
      ssl: { ca: 'synthetic-ca', rejectUnauthorized: true },
    })
  );
});

it('keeps repeated signed observations idempotent without producing additional mock paid credits', async () => {
  await runConfiguredReplayPass(sample.configuration);
  await runConfiguredReplayPass(sample.configuration);
  expect(observations.size).toBe(1);
  expect(paid.size).toBe(1);
  expect(
    state.query.mock.calls.filter(([, sql]) => sql === wrapper)
  ).toHaveLength(2);
});

it.each([
  'tls',
  'identity',
  'authority',
  'pin',
  'expired',
  'membership',
  'broad',
  'transport',
])('refuses observer %s before receipt exhaustion or claims', async (value) => {
  failure = value;
  await expect(runConfiguredReplayPass(sample.configuration)).rejects.toThrow(
    'Staging accrual observer unavailable'
  );
  expect(transport).not.toHaveBeenCalled();
  expect(observations.size).toBe(0);
  expect(paid.size).toBe(0);
});

it('refuses mismatched actual hash-verified evidence scope before any receipt mutation', async () => {
  const parsed = JSON.parse(sample.privateBytes.toString()) as {
    evidence: { integrationId: string };
  };
  parsed.evidence.integrationId = '40000000-0000-4000-8000-000000000009';
  sample.privateBytes = Buffer.from(JSON.stringify(parsed));
  sample.configuration.prefundedReplay.configurationSha256 = createHash(
    'sha256'
  )
    .update(sample.privateBytes)
    .digest('hex');
  await expect(runConfiguredReplayPass(sample.configuration)).rejects.toThrow(
    'Staging accrual observer unavailable'
  );
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  null,
  'f'.repeat(128),
])('cannot observe or credit an accrual without its authentic claim-bound signature', async (proof) => {
  signature = proof;
  sample.rows = sample.rows.slice(3);
  const result = runConfiguredReplayPass(sample.configuration);
  if (proof === null)
    await expect(result).rejects.toThrow('Staging replay deferred');
  else await result;
  expect(observations.size).toBe(0);
  expect(paid.size).toBe(0);
  expect(native).not.toHaveBeenCalled();
});
