import { afterEach, expect, it, vi } from 'vitest';
import type { readReplayConfiguration } from './replay-configuration';
import type { checkFinancialReplayReadiness } from './replay-financial-readiness';
import type { loadPrefundedReplay } from './replay-prefunded-loader';
import { checkReplayReadiness } from './replay-readiness';

const now = 1_900_000_000;
const token = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role, iat: now, exp: now + 3600 })).toString('base64url')}.synthetic`;
const activation = {
  bundleSha256: 'a'.repeat(64),
  configurationSha256: 'b'.repeat(64),
};
const configuration = () => ({
  environment: 'staging',
  receiptToken: token('pvb_staging_worker'),
  appToken: token('pvb_staging_app_worker'),
  receiptKey: Buffer.alloc(32, 1).toString('base64'),
  receiptSystemId: '7686901100561231906',
  appSystemId: '7685292944002592802',
  prefundedReplay: activation,
});

function fixture(
  identities: unknown[] = ['7686901100561231906', '7685292944002592802']
) {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  const replayCallbacks = {
    resolveEnrollment: vi.fn(),
    replay: vi.fn(),
  };
  const read = vi
    .fn<typeof readReplayConfiguration>()
    .mockResolvedValue(configuration());
  const load = vi
    .fn<typeof loadPrefundedReplay>()
    .mockResolvedValue(replayCallbacks);
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) => {
      const request = input as Request;
      const index = request.url.includes('pvb-staging-receipts-rest') ? 0 : 1;
      return new Response(JSON.stringify(identities[index]), { status: 200 });
    });
  const financial = vi
    .fn<typeof checkFinancialReplayReadiness>()
    .mockResolvedValue('ready');
  return { read, load, fetchImplementation, replayCallbacks, financial };
}

afterEach(() => vi.restoreAllMocks());

it('uses the protected config tokens for only the two pinned system-ID reads', async () => {
  const sample = fixture();
  await expect(
    checkReplayReadiness({
      ...sample,
      fetchImplementation: sample.fetchImplementation,
    })
  ).resolves.toEqual({ ready: true });

  expect(sample.load).toHaveBeenCalledExactlyOnceWith({
    activation,
    expectedAppSystemId: '7685292944002592802',
  });
  const requests = sample.fetchImplementation.mock.calls.map(
    ([input]) => input as Request
  );
  expect(requests).toHaveLength(2);
  expect(
    await Promise.all(
      requests.map(async (request) => ({
        url: request.url,
        authorization: request.headers.get('authorization'),
        method: request.method,
        body: await request.clone().text(),
      }))
    )
  ).toEqual([
    {
      url: 'http://pvb-staging-receipts-rest:3000/rpc/piggyvest_staging_system_id',
      authorization: `Bearer ${token('pvb_staging_worker')}`,
      method: 'POST',
      body: '{}',
    },
    {
      url: 'http://baci-isolated-savings-rest-1:3000/rpc/piggyvest_staging_system_id',
      authorization: `Bearer ${token('pvb_staging_app_worker')}`,
      method: 'POST',
      body: '{}',
    },
  ]);
  expect(requests.every((request) => request.method === 'POST')).toBe(true);
  expect(sample.replayCallbacks.resolveEnrollment).not.toHaveBeenCalled();
  expect(sample.replayCallbacks.replay).not.toHaveBeenCalled();
});

it('checks database identities for treasury interest-only mode without loading prefunded replay', async () => {
  const sample = fixture();
  const { prefundedReplay: _activation, ...withoutPrefundedReplay } =
    configuration();
  sample.read.mockResolvedValue({
    ...withoutPrefundedReplay,
    financialDatabase: {
      host: 'piggyvest-db.staging.baci.internal',
      port: 5432,
      database: 'postgres',
      role: 'prefunded_treasury_operator',
      password: 'synthetic-password',
      integrationId: '40000000-0000-4000-8000-000000000001',
      businessId: 'business',
      ssl: { ca: 'synthetic-ca' },
    },
  });

  await expect(checkReplayReadiness(sample)).resolves.toEqual({ ready: true });

  expect(sample.load).not.toHaveBeenCalled();
  expect(sample.fetchImplementation).toHaveBeenCalledTimes(2);
  expect(sample.financial).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ role: 'prefunded_treasury_operator' }),
    '7685292944002592802'
  );
  sample.financial.mockResolvedValue('authority-unavailable');
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage: 'interest-authority',
  });
  sample.financial.mockResolvedValue('transport-unavailable');
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage: 'financial-database',
  });
  sample.financial.mockRejectedValue(new Error('password=synthetic-password'));
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage: 'financial-database',
  });
});

it('redacts protected config and runtime loader failures into fixed stages', async () => {
  const configFailure = fixture();
  configFailure.read.mockRejectedValue(new Error('token=private-config'));
  await expect(checkReplayReadiness(configFailure)).resolves.toEqual({
    ready: false,
    stage: 'configuration',
  });
  expect(configFailure.load).not.toHaveBeenCalled();
  expect(configFailure.fetchImplementation).not.toHaveBeenCalled();

  const runtimeFailure = fixture();
  runtimeFailure.load.mockRejectedValue(new Error('database=private-config'));
  await expect(checkReplayReadiness(runtimeFailure)).resolves.toEqual({
    ready: false,
    stage: 'prefunded-runtime',
  });
  expect(runtimeFailure.fetchImplementation).not.toHaveBeenCalled();
});

it('refuses malformed configuration and missing activation before network access', async () => {
  const malformed = fixture();
  malformed.read.mockResolvedValue({
    ...configuration(),
    unexpected: 'private',
  });
  await expect(checkReplayReadiness(malformed)).resolves.toEqual({
    ready: false,
    stage: 'configuration',
  });

  const missing = fixture();
  const { prefundedReplay: _activation, ...withoutActivation } =
    configuration();
  missing.read.mockResolvedValue(withoutActivation);
  await expect(checkReplayReadiness(missing)).resolves.toEqual({
    ready: false,
    stage: 'prefunded-runtime',
  });
  expect(malformed.fetchImplementation).not.toHaveBeenCalled();
  expect(missing.load).not.toHaveBeenCalled();
  expect(missing.fetchImplementation).not.toHaveBeenCalled();
});

it.each([
  {
    identities: ['wrong-receipt', '7685292944002592802'],
    stage: 'receipt-database',
  },
  {
    identities: ['7686901100561231906', [{ result: '7685292944002592802' }]],
    stage: 'app-database',
  },
])('rejects malformed or unpinned database identities', async ({
  identities,
  stage,
}) => {
  const sample = fixture(identities);
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage,
  });
  expect(sample.fetchImplementation).toHaveBeenCalledTimes(2);
});

it('redacts a private RPC transport failure and still probes both identities', async () => {
  const sample = fixture();
  sample.fetchImplementation.mockImplementation(async (input) => {
    const request = input as Request;
    if (request.url.includes('pvb-staging-receipts-rest'))
      throw new Error('authorization=private');
    return new Response(JSON.stringify('7685292944002592802'), { status: 200 });
  });
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage: 'receipt-database',
  });
  expect(sample.fetchImplementation).toHaveBeenCalledTimes(2);
});

it.each([
  {
    host: 'pvb-staging-receipts-rest',
    stage: 'receipt-database',
    status: 401,
    body: 'token=secret-receipt-response',
  },
  {
    host: 'baci-isolated-savings-rest-1',
    stage: 'app-database',
    status: 401,
    body: 'token=secret-app-response',
  },
])('redacts HTTP 401 response from $host', async ({
  host,
  stage,
  status,
  body,
}) => {
  const sample = fixture();
  sample.fetchImplementation.mockImplementation(async (input) => {
    const request = input as Request;
    if (request.url.includes(host)) return new Response(body, { status });
    const identity = request.url.includes('pvb-staging-receipts-rest')
      ? '7686901100561231906'
      : '7685292944002592802';
    return new Response(JSON.stringify(identity), { status: 200 });
  });
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage,
  });
  expect(sample.fetchImplementation).toHaveBeenCalledTimes(2);
});

it.each([
  {
    host: 'pvb-staging-receipts-rest',
    stage: 'receipt-database',
    body: 'token=secret-receipt-malformed-json',
  },
  {
    host: 'baci-isolated-savings-rest-1',
    stage: 'app-database',
    body: 'token=secret-app-malformed-json',
  },
])('redacts malformed JSON from $host', async ({ host, stage, body }) => {
  const sample = fixture();
  sample.fetchImplementation.mockImplementation(async (input) => {
    const request = input as Request;
    if (request.url.includes(host)) return new Response(body, { status: 200 });
    const identity = request.url.includes('pvb-staging-receipts-rest')
      ? '7686901100561231906'
      : '7685292944002592802';
    return new Response(JSON.stringify(identity), { status: 200 });
  });
  await expect(checkReplayReadiness(sample)).resolves.toEqual({
    ready: false,
    stage,
  });
  expect(sample.fetchImplementation).toHaveBeenCalledTimes(2);
});
