const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const collect = require('./provider_crosswalk.cjs');
const refused = /^Error: provider_crosswalk_refused$/;

const origin = 'https://staging.piggyvest.business';
const source = '01M238A0V75387H4HZ15YFWGX3';
const destination = '01M3W0Y93XHJY9RPQ2G75X81WG';
const business = '01M2381RG34HQJMHQKE7DWDACR';
const customer = 'c096507d-dc32-45d2-9c01-871a27abfd10';
const apiCustomer = '01M2T3PAHG3P5A32REX8MH3HD7';
const transaction = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V';
const reference = 'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65';
const paths = [
  `/api/v1/transaction/verify?reference=${reference}&wallet_id=${source}`,
  `/api/v1/wallet/${source}`,
  `/api/v1/wallet/${destination}`,
  `/api/v1/wallet/api/wallet-type?customer_id=${apiCustomer}&limit=100`,
];

function fixture() {
  const event = {
    eventId: '01M3YP771123DWC9Y8Y4814Z8Y',
    eventType: 'wallet-transfer.outflow.success',
    eventCategory: 'wallet_transfer',
    customer_id: customer,
    pvb_wallet: source,
    pvb_destination_wallet: destination,
    pvb_third_party_reference: reference,
    eventData: {
      id: '34c57f9b-8697-46a9-954f-b93bfd888a36',
      transaction_id: '2d3ee34a-74e9-4992-b0c2-f8a653e4ff02',
      customer_id: customer,
      source_wallet: '01M238A757Y931HHB238T7MCFM',
      destination_wallet: '01M3W0YENHMFJ8Z9FS76E3CC6T',
      amount: 10000,
      currency: 'NGN',
      fee: null,
      status: 'COMPLETED',
      type: 'inter',
      category: 'p2p',
      reference: '01M3YP6VMSZX61CMB5V4Z07RAJ',
      internal_reference: '01M3YP6VMSZX61CMB5V4Z07RAJ',
      third_party_reference: transaction,
      initiator_reference: transaction,
    },
  };
  const wallets = [source, destination].map((id, index) => ({
    status: true,
    data: {
      id,
      faas_wallet_identifier: index
        ? event.eventData.destination_wallet
        : event.eventData.source_wallet,
      business_id: business,
      api_customer_id: index ? apiCustomer : null,
      currency: 'NGN',
      status: 'active',
      balance: index ? 10000 : 0,
    },
  }));
  return {
    input: {
      event,
      executionDeadline: '2026-10-06T15:59:10Z',
      piggyvest: {
        apiBaseUrl: origin,
        apiSecret: 'test_key_synthetic_only',
        expectedBusinessId: business,
        expectedCurrency: 'NGN',
        timeoutMs: 5000,
        maxResponseBytes: 65536,
      },
    },
    responses: [
      {
        status: true,
        data: {
          id: transaction,
          internal_reference: transaction,
          reference: event.eventData.reference,
          third_party_reference: reference,
          customer_id: business,
          source_wallet: source,
          destination_wallet: destination,
          status: 'successful',
          amount: 10000,
          fee: 0,
        },
      },
      ...wallets,
      {
        status: true,
        data: { paginatedPayload: { edges: [{ ...wallets[1].data }] } },
      },
    ],
  };
}

function mockFetch(responses, calls = []) {
  return (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(responses[calls.length - 1]))
    );
  };
}

test('collects the exact four GETs and returns only independently checked namespace IDs', async () => {
  const { input, responses } = fixture();
  const before = JSON.stringify(input);
  const calls = [];
  const result = await collect(input, mockFetch(responses, calls));
  const { observedAt, ...sanitized } = result;
  assert.deepEqual(sanitized, {
    status: 'provider-crosswalk-readonly-verified',
    publicWalletId: destination,
    faasWalletId: input.event.eventData.destination_wallet,
    apiCustomerId: apiCustomer,
    providerCustomerId: customer,
    nativeCustomerId: customer,
    publicFaasMatches: true,
  });
  assert.ok(Number.isFinite(Date.parse(observedAt)));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    calls.map((call) => call.url),
    paths.map((path) => origin + path)
  );
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.body, undefined);
    assert.equal(
      init.headers.Authorization,
      `Bearer ${input.piggyvest.apiSecret}`
    );
  }
  assert.ok(!JSON.stringify(result).includes(input.piggyvest.apiSecret));
});

test('preserves optional TSQ currency/business/destination-customer semantics', async () => {
  const { input, responses } = fixture();
  Object.assign(responses[0].data, {
    currency: 'NGN',
    business_id: business,
    destination_customer_id: customer,
  });
  const result = await collect(input, mockFetch(responses));
  assert.equal(result.status, 'provider-crosswalk-readonly-verified');
});

test('refuses production, wrong config authority, deadline and unsafe limits before any GET', async () => {
  for (const [key, value] of [
    ['apiBaseUrl', 'https://piggyvest.business'],
    ['apiBaseUrl', `${origin}/`],
    ['apiSecret', 'live_key_synthetic_only'],
    ['apiSecret', 'test_key_bad\nheader'],
    ['expectedBusinessId', customer],
    ['expectedCurrency', 'USD'],
    ['timeoutMs', 10001],
    ['timeoutMs', 0],
    ['maxResponseBytes', 1048577],
    ['maxResponseBytes', 0],
    ['extra', true],
  ]) {
    const { input, responses } = fixture();
    input.piggyvest[key] = value;
    const calls = [];
    await assert.rejects(collect(input, mockFetch(responses, calls)), refused);
    assert.equal(calls.length, 0);
  }
  const { input, responses } = fixture();
  input.executionDeadline = '2026-10-03T00:00:00Z';
  const calls = [];
  await assert.rejects(collect(input, mockFetch(responses, calls)));
  assert.equal(calls.length, 0);
});

test('refuses signed customer/business/FAAS/UUID/alias namespace substitutions before GET', async () => {
  for (const [key, value] of [
    ['customer_id', business],
    ['transaction_id', transaction],
    ['source_wallet', source],
    ['destination_wallet', destination],
    ['status', 'successful'],
    ['amount', 10001],
    ['fee', 1],
    ['initiator_reference', 'foreign'],
  ]) {
    const { input, responses } = fixture();
    input.event.eventData[key] = value;
    const calls = [];
    await assert.rejects(collect(input, mockFetch(responses, calls)));
    assert.equal(calls.length, 0);
  }
});

test('refuses mismatched TSQ and wallet identities, economics and list cardinality', async () => {
  const entry = fixture().responses[3].data.paginatedPayload.edges[0];
  const mutations = [
    [0, 'id', 'foreign'],
    [0, 'internal_reference', 'foreign'],
    [0, 'reference', 'foreign'],
    [0, 'third_party_reference', 'foreign'],
    [0, 'customer_id', customer],
    [0, 'business_id', customer],
    [0, 'destination_customer_id', business],
    [0, 'source_wallet', destination],
    [0, 'destination_wallet', source],
    [0, 'status', 'COMPLETED'],
    [0, 'amount', 9999],
    [0, 'fee', 1],
    [0, 'currency', 'USD'],
    [1, 'faas_wallet_identifier', source],
    [2, 'api_customer_id', customer],
    [2, 'business_id', customer],
    [2, 'currency', 'USD'],
    [2, 'status', 'closed'],
    [3, 'paginatedPayload', { edges: [] }],
    [3, 'paginatedPayload', { edges: [entry, entry] }],
    [
      3,
      'paginatedPayload',
      { edges: [{ ...entry, faas_wallet_identifier: 'foreign' }] },
    ],
  ];
  for (const [index, key, value] of mutations) {
    const { input, responses } = fixture();
    responses[index].data[key] = value;
    await assert.rejects(collect(input, mockFetch(responses)), refused);
  }
});

test('refuses HTTP/redirect/network/malformed/duplicate JSON without exposing private bodies', async () => {
  const bodies = [
    new Response('private-marker', { status: 503 }),
    new Response('private-marker', { status: 302 }),
    new Response('{bad-private-marker'),
    new Response(
      '{"status":false,"sta\\u0074us":true,"data":"private-marker"}'
    ),
  ];
  for (const response of bodies) {
    await assert.rejects(
      collect(fixture().input, () => Promise.resolve(response)),
      refused
    );
  }
  await assert.rejects(
    collect(fixture().input, () => Promise.reject(new Error('private-marker'))),
    refused
  );
});

test('enforces declared and streamed byte limits, fatal UTF8 and stalled fetch/body deadlines', async () => {
  const { input } = fixture();
  input.piggyvest.maxResponseBytes = 100;
  for (const response of [
    new Response(' '.repeat(101)),
    new Response('{}', { headers: { 'content-length': '101' } }),
    new Response(Uint8Array.from([255])),
  ]) {
    await assert.rejects(
      collect(input, () => Promise.resolve(response)),
      refused
    );
  }
  input.piggyvest.timeoutMs = 1;
  await assert.rejects(
    collect(input, () => new Promise(() => undefined)),
    refused
  );
  await assert.rejects(
    collect(input, () => Promise.resolve(new Response(new ReadableStream()))),
    refused
  );
});

test('stdin CLI refuses duplicate keys and production credentials without logs or network', () => {
  const input = fixture().input;
  input.piggyvest.apiSecret = 'live_key_private-marker';
  for (const raw of [
    JSON.stringify(input),
    '{"event":{},"ev\\u0065nt":{"secret":"private-marker"}}',
  ]) {
    const result = spawnSync(
      process.execPath,
      [require.resolve('./provider_crosswalk.cjs')],
      { input: raw, encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '{"status":"refused"}\n');
    assert.equal(result.stderr, '');
  }
});
