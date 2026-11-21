import { createOxygenStagingFetch } from './oxygen-staging-fetch';
import { readOxygenStagingProfile } from './oxygen-staging-profile';

const profile = readOxygenStagingProfile(
  {
    apiOrigin: 'http://127.0.0.1:3000',
    authOrigin: 'https://staging-auth.example.com',
    expectedAuthIssuer: 'https://staging-auth.example.com/auth/v1',
    publicKey: `sb_publishable_${'a'.repeat(24)}`,
    merchantId: '11111111-1111-4111-8111-111111111111',
    merchantSlug: 'oxygen-test',
  },
  true
);
const token = (issuer = profile.expectedAuthIssuer) =>
  `a.${btoa(JSON.stringify({ iss: issuer, role: 'authenticated', sub: 'user', exp: 4102444800 }))}.a`;
test('auth can bootstrap before capabilities; authenticated Oxygen and orders share API', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const fetcher = createOxygenStagingFetch(transport, profile);
  await fetcher(`${profile.authOrigin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: profile.publicKey },
  });
  for (const [path, method] of [
    ['/api/payments/oxygen/mobile-capabilities', 'GET'],
    ['/api/orders', 'POST'],
  ]) {
    await fetcher(`${profile.apiOrigin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token()}` },
    });
  }
  expect(transport).toHaveBeenCalledTimes(3);
  expect(transport.mock.calls[2][1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
  });
});

test('allows only authenticated read access to checkout savings goals', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const fetcher = createOxygenStagingFetch(transport, profile);
  const url = `${profile.apiOrigin}/api/storefront/customer/savings/goals?merchantSlug=oxygen-test`;
  await fetcher(url, { headers: { authorization: `Bearer ${token()}` } });
  await expect(fetcher(url)).rejects.toThrow();
  await expect(
    fetcher(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token()}` },
    })
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
test('blocks foreign issuer, cookies, privileged/unknown paths and redirects before leaking credentials', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const fetcher = createOxygenStagingFetch(transport, profile);
  for (const [url, init] of [
    ['https://usebaci.com/api/orders', { method: 'POST' }],
    [`${profile.apiOrigin}/api/wallet`, { method: 'POST' }],
    [
      `${profile.apiOrigin}/api/payments/oxygen/workflows`,
      { headers: { cookie: 'session=x' } },
    ],
    [
      `${profile.apiOrigin}/api/orders`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token('https://production/auth/v1')}`,
        },
      },
    ],
    [`${profile.authOrigin}/rest/v1/transactions`, { method: 'POST' }],
  ] as const)
    await expect(fetcher(url, init)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValue(
    new Response('', { status: 302, headers: { location: 'https://evil.com' } })
  );
  await expect(
    fetcher(`${profile.apiOrigin}/api/payments/oxygen/mobile-capabilities`, {
      headers: { authorization: `Bearer ${token()}` },
    })
  ).rejects.toThrow();
});

test.each([
  'snapshot',
  'retirePhone',
] as const)('real Oxygen client %s passes through the installed transport boundary', async (operation) => {
  const { createOxygenClient } = await import('../services/oxygen/client');
  const id = profile.merchantId;
  const snapshot = {
    workflowId: id,
    stage: 'application_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    state: {},
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    checkoutPhone: '',
    checkoutAddress: {},
  };
  const payload = operation === 'snapshot' ? snapshot : { retired: true };
  const transport = jest
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload)));
  const client = createOxygenClient({
    profile,
    getSession: async () => ({ access_token: token(), user: { id } }),
    fetch: createOxygenStagingFetch(transport, profile),
  });
  const result =
    operation === 'snapshot'
      ? await client.snapshot(id)
      : await client.retirePhone({
          workflowId: id,
          version: 1,
          idempotencyKey: id,
        });
  expect(result).toEqual(payload);
  expect(transport).toHaveBeenCalledTimes(1);
  const request = transport.mock.calls[0][0] as Request;
  expect(request.url).toBe(
    `${profile.apiOrigin}/api/payments/oxygen/workflows/${operation === 'snapshot' ? `actions?workflowId=${id}` : 'phone-recovery'}`
  );
  expect(request.method).toBe(operation === 'snapshot' ? 'GET' : 'POST');
  expect(transport.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
  });
});

test('same-origin local gateway allows only its pinned Auth prefix and preserves protected API routing', async () => {
  const anon = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ iss: 'supabase', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, '')}.synthetic-signature`;
  const gateway = readOxygenStagingProfile(
    {
      ...profile,
      authOrigin: profile.apiOrigin,
      authBaseUrl: `${profile.apiOrigin}/qa-backend`,
      expectedAuthIssuer: 'supabase',
      publicKey: anon,
    },
    true
  );
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const guardedFetch = createOxygenStagingFetch(transport, gateway);
  await guardedFetch(
    `${gateway.authBaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: anon, authorization: `Bearer ${anon}` },
    }
  );
  await guardedFetch(`${gateway.authBaseUrl}/rest/v1/customers?select=id`, {
    headers: { apikey: anon, authorization: `Bearer ${token('supabase')}` },
  });
  await guardedFetch(
    `${gateway.apiOrigin}/api/payments/oxygen/workflows/actions?workflowId=${profile.merchantId}`,
    {
      headers: { authorization: `Bearer ${token('supabase')}` },
    }
  );
  expect(transport).toHaveBeenCalledTimes(3);
  for (const [url, init] of [
    [
      `${gateway.authOrigin}/auth/v1/token`,
      { method: 'POST', headers: { apikey: anon } },
    ],
    [
      `${gateway.authOrigin}/qa-backend-foreign/auth/v1/token`,
      { method: 'POST' },
    ],
    [`${gateway.authBaseUrl}/auth/v1/admin/users`, { method: 'POST' }],
    [
      `${gateway.apiOrigin}/api/payments/oxygen/workflows/actions`,
      { headers: { authorization: `Bearer ${anon}` } },
    ],
    [`${gateway.authBaseUrl}/rest/v1/customers`, { method: 'POST' }],
  ] as const)
    await expect(guardedFetch(url, init)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(3);
});

test('admits exact shopper read projections needed by the existing native catalog and cart', async () => {
  const transport = jest.fn().mockResolvedValue(new Response('[]'));
  const guardedFetch = createOxygenStagingFetch(transport, profile);
  const headers = {
    apikey: profile.publicKey,
    authorization: `Bearer ${profile.publicKey}`,
  };
  await guardedFetch(
    `${profile.authBaseUrl}/rest/v1/page_configs?select=published_config`,
    { headers }
  );
  for (const rpc of [
    'get_storefront_product_variants',
    'get_storefront_product_base_inventory',
    'get_storefront_offer_resolution',
    'get_storefront_payment_settings',
    'get_order_variant_overrides',
    'search_products_v2',
  ]) {
    await guardedFetch(`${profile.authBaseUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers,
      body: '{}',
    });
  }
  expect(transport).toHaveBeenCalledTimes(7);
  for (const rpc of [
    'upsert_customer_on_auth',
    'register_push_token',
    'debit_customer_wallet',
    'get_storefront_payment_settings_extra',
  ]) {
    await expect(
      guardedFetch(`${profile.authBaseUrl}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers,
        body: '{}',
      })
    ).rejects.toThrow();
  }
  await expect(
    guardedFetch(
      `${profile.authBaseUrl}/rest/v1/rpc/get_storefront_payment_settings`,
      { method: 'DELETE', headers }
    )
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(7);
});

test('local anon bootstrap and authenticated API requests validate different independently pinned issuers', async () => {
  const userIssuer = 'https://staging-auth.example.com/auth/v1';
  const anon = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ iss: 'supabase', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, '')}.synthetic-signature`;
  const gateway = readOxygenStagingProfile(
    {
      ...profile,
      authOrigin: profile.apiOrigin,
      authBaseUrl: `${profile.apiOrigin}/qa-backend`,
      expectedAuthIssuer: userIssuer,
      publicKey: anon,
    },
    true
  );
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const fetcher = createOxygenStagingFetch(transport, gateway);
  await fetcher(`${gateway.authBaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${anon}` },
  });
  await fetcher(
    `${gateway.apiOrigin}/api/payments/oxygen/mobile-capabilities`,
    { headers: { authorization: `Bearer ${token(userIssuer)}` } }
  );
  await expect(
    fetcher(`${gateway.apiOrigin}/api/payments/oxygen/mobile-capabilities`, {
      headers: { authorization: `Bearer ${token('supabase')}` },
    })
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
});

const workflowLookup = [
  'select=id',
  'environment=eq.staging',
  'order_id=eq.aebdc237-5363-4e2b-b0ee-5be12ea9edab',
  'customer_id=eq.c434e49c-8a56-4a4f-82f7-2f4d0e165546',
  'merchant_id=eq.3adf89f9-67ec-4dda-9037-e691eec1ff9b',
].join('&');

test.each([
  `${workflowLookup}&select=id`,
  `${workflowLookup}&order=created_at`,
  'select=id&environment=eq.staging',
])('rejects broadened staging workflow lookups (%s)', async (query) => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const guardedFetch = createOxygenStagingFetch(transport, profile);
  await expect(
    guardedFetch(`${profile.authOrigin}/rest/v1/oxygen_workflows?${query}`, {
      headers: { authorization: `Bearer ${token()}` },
    })
  ).rejects.toThrow('blocked an unapproved request');
  expect(transport).not.toHaveBeenCalled();
});

test.each([
  'customers',
  'orders',
  'order_items',
  'oxygen_workflows',
])('requires a signed-in staging session for %s reads', async (table) => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const guardedFetch = createOxygenStagingFetch(transport, profile);
  const query = table === 'oxygen_workflows' ? workflowLookup : 'select=id';
  const url = `${profile.authOrigin}/rest/v1/${table}?${query}`;
  await expect(
    guardedFetch(url, {
      headers: { authorization: `Bearer ${profile.publicKey}` },
    })
  ).rejects.toThrow('blocked an unapproved request');
  await guardedFetch(url, { headers: { authorization: `Bearer ${token()}` } });
  expect(transport).toHaveBeenCalledTimes(1);
});
