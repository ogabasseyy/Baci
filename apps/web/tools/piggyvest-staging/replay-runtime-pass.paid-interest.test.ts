// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrefundedReceiptReplay } from './replay-prefunded';
import type { readProtectedReplayFile } from './replay-protected-file';

const state = vi.hoisted(() => ({
  read: vi.fn<typeof readProtectedReplayFile>(),
  factory: vi.fn(),
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor(configuration: unknown) {
      state.construct(configuration);
    }
    connect = state.connect;
    query = state.query;
    end = state.end;
    on = state.on;
  },
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

import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';
import { runConfiguredReplayPass } from './replay-runtime-pass';

let sample: ReturnType<typeof createPaidInterestTestFixture>;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let callbacks: PrefundedReceiptReplay;
let tls: boolean;
let authority: boolean;
let identity: string;
const recognizedInterest = new Set<unknown>();
const recognizedBank = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  sample = createPaidInterestTestFixture();
  tls = true;
  authority = true;
  identity = sample.configuration.appSystemId;
  recognizedInterest.clear();
  recognizedBank.clear();
  state.connect.mockResolvedValue(undefined);
  state.end.mockResolvedValue(undefined);
  state.read.mockImplementation(async ({ path }: { path: string }) =>
    path.endsWith('.json') ? sample.privateBytes : sample.bundle
  );
  state.query.mockImplementation(
    async (statement: string, parameters?: unknown[]) => {
      if (statement.startsWith('SELECT session_user'))
        return {
          rows: [
            {
              login: 'prefunded_treasury_operator',
              role: 'prefunded_treasury_operator',
              database: 'postgres',
              read_only: 'on',
              ssl: tls,
              unsafe: false,
            },
          ],
        };
      if (statement.includes('executor_system_identity()'))
        return {
          rows: [
            {
              result: {
                login: 'prefunded_treasury_operator',
                database: 'postgres',
                systemIdentifier: identity,
              },
            },
          ],
        };
      if (statement.includes('has_function_privilege'))
        return { rows: [{ authorized: authority }] };
      if (statement === PIGGYVEST_INTEREST_REPLAY_STATEMENT.text) {
        const eventId = parameters?.[4];
        const result = recognizedInterest.has(eventId)
          ? 'duplicate'
          : 'applied';
        recognizedInterest.add(eventId);
        return { rows: [{ result }] };
      }
      return {
        rows: [],
        command: statement === 'COMMIT' ? 'COMMIT' : undefined,
      };
    }
  );
  callbacks = {
    resolveEnrollment: vi.fn(async () => 'enrolled'),
    replay: vi.fn(async ({ rawPayload }) => {
      const event: { eventId: string; eventType: string } = JSON.parse(
        Buffer.from(rawPayload).toString()
      );
      if (event.eventType === 'wallet-transfer.outflow.success')
        return { outcome: 'processed', projection: 'not_applicable' };
      const projection = recognizedBank.has(event.eventId)
        ? 'duplicate'
        : 'applied';
      recognizedBank.add(event.eventId);
      return { outcome: 'processed', projection };
    }),
  };
  state.factory.mockResolvedValue(callbacks);
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
      return Response.json({
        receiptId: body.p_receipt_id,
        payloadSha256: body.p_payload_sha256,
        signature: 'a'.repeat(128),
      });
    if (rpc === 'resolve_piggyvest_staging_receipt') return Response.json(true);
    throw new Error(`Unexpected mocked RPC: ${rpc}`);
  });
  vi.stubGlobal('fetch', transport);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('recovers mixed bank/native-outflow/paid-interest receipts through one actual configured claimant', async () => {
  expect(
    new URL('./prefunded-replay-bundle.mjs', import.meta.url).protocol
  ).toBe('file:');
  await runConfiguredReplayPass(sample.configuration);
  const requests = transport.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input)
  );
  expect(
    requests.filter((url) => url.endsWith('/claim_piggyvest_staging_receipts'))
  ).toHaveLength(1);
  expect(
    requests.filter((url) => url.endsWith('/resolve_piggyvest_staging_receipt'))
  ).toHaveLength(3);
  expect(console.log).toHaveBeenCalledWith(
    JSON.stringify({
      replay: 'staging-pass-complete',
      claimed: 3,
      processed: 3,
      quarantined: 0,
      retryable: 0,
      resolutionFailures: 0,
    })
  );
  expect(callbacks.resolveEnrollment).toHaveBeenCalledTimes(2);
  expect(callbacks.replay).toHaveBeenCalledTimes(2);
  expect(recognizedInterest.size).toBe(1);
  expect(recognizedBank.size).toBe(1);
  const mutations = state.query.mock.calls.filter(([statement]) =>
    statement.startsWith('SELECT piggyvest_savings_ledger.apply_')
  );
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toEqual([
    PIGGYVEST_INTEREST_REPLAY_STATEMENT.text,
    [
      sample.scope.integrationId,
      sample.scope.businessId,
      sample.scope.expectedSystemId,
      expect.any(String),
      'paid-interest-001',
    ],
  ]);
  expect(state.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      user: 'prefunded_treasury_operator',
      ssl: { ca: 'synthetic-ca', rejectUnauthorized: true },
    })
  );
  const readiness = state.query.mock.calls.findIndex(([statement]) =>
    statement.includes('has_function_privilege')
  );
  expect(state.query.mock.invocationCallOrder[readiness]).toBeLessThan(
    transport.mock.invocationCallOrder[0]
  );
});

it('repeated verified receipts retain durable duplicate acknowledgements without a second mock credit', async () => {
  await runConfiguredReplayPass(sample.configuration);
  await runConfiguredReplayPass(sample.configuration);
  expect(recognizedInterest.size).toBe(1);
  expect(recognizedBank.size).toBe(1);
  expect(callbacks.replay).toHaveBeenCalledTimes(4);
  expect(
    state.query.mock.calls.filter(
      ([statement]) => statement === PIGGYVEST_INTEREST_REPLAY_STATEMENT.text
    )
  ).toHaveLength(2);
});

it.each([
  'integrationId',
  'businessId',
  'expectedSystemId',
])('refuses pinned private %s mismatch before any claim or exhaustion', async (field) => {
  sample.privateBytes = Buffer.from(
    JSON.stringify({
      scope: {
        ...sample.scope,
        [field]:
          field === 'integrationId'
            ? '40000000-0000-4000-8000-000000000009'
            : field === 'expectedSystemId'
              ? '1'
              : 'wrong',
      },
    })
  );
  sample.configuration.prefundedReplay.configurationSha256 = createHash(
    'sha256'
  )
    .update(sample.privateBytes)
    .digest('hex');
  await expect(runConfiguredReplayPass(sample.configuration)).rejects.toThrow(
    'Staging prefunded replay unavailable'
  );
  expect(transport).not.toHaveBeenCalled();
  expect(state.construct).not.toHaveBeenCalled();
  expect(state.factory).not.toHaveBeenCalled();
});

it.each([
  'tls',
  'authority',
  'identity',
  'transport',
])('refuses actual %s readiness before any receipt mutation', async (failure) => {
  if (failure === 'tls') tls = false;
  if (failure === 'authority') authority = false;
  if (failure === 'identity') identity = '1';
  if (failure === 'transport')
    state.connect.mockRejectedValueOnce(new Error('secret transport failure'));
  await expect(runConfiguredReplayPass(sample.configuration)).rejects.toThrow(
    'Staging paid interest unavailable'
  );
  expect(state.connect).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
  expect(callbacks.replay).not.toHaveBeenCalled();
  expect(
    state.query.mock.calls.some(([statement]) =>
      statement.startsWith('SELECT piggyvest_savings_ledger.apply_')
    )
  ).toBe(false);
});

it('refuses an injected factory surface in paired mode instead of trusting a caller-supplied scope', async () => {
  await expect(
    runConfiguredReplayPass(sample.configuration, {
      prefundedReplay: callbacks,
    })
  ).rejects.toThrow('Paired replay requires pinned runtime loading');
  expect(transport).not.toHaveBeenCalled();
  expect(state.factory).not.toHaveBeenCalled();
});
