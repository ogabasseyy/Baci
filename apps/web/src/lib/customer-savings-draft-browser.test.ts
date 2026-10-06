import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from './customer-savings-draft.test-fixture';
import { createCustomerSavingsDraftBrowser } from './customer-savings-draft-browser';
import { customerSavingsDraftView } from './customer-savings-draft-view';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser, onAuthStateChange: mocks.subscribe },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));
const fixture = savingsDraftFixture();
const scope = {
  merchantId: fixture.merchantId,
  userId: fixture.record.draftId,
};
const draft = customerSavingsDraftView(fixture.record);
beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: test must seed/clear the CSRF cookie the browser module reads.
  document.cookie = 'csrf-token=test-csrf; path=/';
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55431');
  mocks.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: scope.userId } }, error: null });
  mocks.subscribe.mockReset().mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
});
afterEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: test must seed/clear the CSRF cookie the browser module reads.
  document.cookie = 'csrf-token=; max-age=0; path=/';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('uses real cookie CSRF transport and never sends client prices or bearer credentials', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ draft })));
  vi.stubGlobal('fetch', fetcher);
  const api = createCustomerSavingsDraftBrowser(scope, vi.fn());
  await expect(
    api.create({
      productId: draft.productId,
      variantId: draft.variantId,
      requestId: draft.requestId,
    })
  ).resolves.toEqual(draft);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/storefront/customer/savings/drafts');
  expect(options).toMatchObject({
    credentials: 'include',
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
  });
  expect(new Headers(options.headers).get('x-csrf-token')).toBe('test-csrf');
  expect(new Headers(options.headers).has('Authorization')).toBe(false);
  expect(JSON.parse(options.body)).toEqual({
    merchantId: scope.merchantId,
    productId: draft.productId,
    variantId: draft.variantId,
    requestId: draft.requestId,
  });
  api.close();
});
it('rejects changed sessions before dispatch', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const invalidate = vi.fn();
  const api = createCustomerSavingsDraftBrowser(scope, invalidate);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(api.list()).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalled();
  api.close();
});
it('initializes the CSRF cookie before dispatching a retained create request', async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: test must seed/clear the CSRF cookie the browser module reads.
  document.cookie = 'csrf-token=; max-age=0; path=/';
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/csrf') {
      // biome-ignore lint/suspicious/noDocumentCookie: test must seed/clear the CSRF cookie the browser module reads.
      document.cookie = 'csrf-token=initialized-csrf; path=/';
      return new Response('{}');
    }
    return new Response(JSON.stringify({ draft }));
  });
  vi.stubGlobal('fetch', fetcher);
  const api = createCustomerSavingsDraftBrowser(scope, vi.fn());
  await expect(
    api.create({
      productId: draft.productId,
      variantId: draft.variantId,
      requestId: draft.requestId,
    })
  ).resolves.toEqual(draft);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/csrf',
    '/api/storefront/customer/savings/drafts',
  ]);
  expect(
    new Headers(fetcher.mock.calls[1][1].headers).get('x-csrf-token')
  ).toBe('initialized-csrf');
  api.close();
});
it('rejects a pending response after logout even when fetch ignores cancellation', async () => {
  const response = Promise.withResolvers<Response>();
  const dispatched = Promise.withResolvers<void>();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      dispatched.resolve();
      return response.promise;
    })
  );
  const invalidate = vi.fn();
  const api = createCustomerSavingsDraftBrowser(scope, invalidate);
  const pending = api.list();
  const rejected = expect(pending).rejects.toThrow();
  await dispatched.promise;
  mocks.subscribe.mock.calls[0][0]('SIGNED_OUT', null);
  response.resolve(new Response(JSON.stringify({ drafts: [draft] })));
  await rejected;
  expect(invalidate).toHaveBeenCalledOnce();
  api.close();
});
it('scopes catalogue reads and preserves exact variants with bounded search pagination', async () => {
  const products = [{ ...fixture.record.catalogue, has_variants: true }];
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockResolvedValue({
      data: products.map((product) => ({ ...product, variants: [] })),
      error: null,
    }),
  };
  const variants = products.flatMap((product) =>
    (product.variants ?? []).map((variant) => ({
      ...variant,
      product_id: product.id,
    }))
  );
  const variantBuilder = {
    range: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockResolvedValue({
      data: variants,
      count: variants.length,
      error: null,
    }),
  };
  mocks.rpc.mockReturnValue(variantBuilder);
  mocks.from.mockReturnValue(builder);
  const api = createCustomerSavingsDraftBrowser(scope, vi.fn());
  await expect(api.catalogue('phone%', 2)).resolves.toEqual(products);
  expect(builder.eq).toHaveBeenCalledWith('merchant_id', scope.merchantId);
  expect(builder.eq).toHaveBeenCalledWith('status', 'active');
  expect(builder.range).toHaveBeenCalledWith(40, 59);
  expect(builder.ilike).toHaveBeenCalledWith('name', '%phone\\%%');
  expect(builder.select.mock.calls[0][0]).not.toContain('product_variants');
  expect(mocks.rpc).toHaveBeenCalledWith(
    'get_storefront_product_variants',
    { p_product_ids: products.map((product) => product.id) },
    { count: 'exact' }
  );
  variantBuilder.abortSignal.mockResolvedValue({
    data: variants,
    count: variants.length + 1,
    error: null,
  });
  await expect(api.catalogue()).rejects.toThrow('Catalogue unavailable.');
  variantBuilder.abortSignal.mockResolvedValue({
    data: variants.map((variant) => ({ ...variant, product_id: scope.userId })),
    count: variants.length,
    error: null,
  });
  await expect(api.catalogue()).rejects.toThrow('Catalogue unavailable.');
  variantBuilder.abortSignal.mockResolvedValue({
    data: null,
    count: null,
    error: { message: 'private variant detail' },
  });
  await expect(api.catalogue()).rejects.toThrow('Catalogue unavailable.');
  builder.abortSignal.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockClear();
  await expect(api.catalogue()).resolves.toEqual([]);
  expect(mocks.rpc).not.toHaveBeenCalled();
  builder.abortSignal.mockResolvedValue({
    data: null,
    error: { message: 'private database detail' },
  });
  await expect(api.catalogue()).rejects.toThrow('Catalogue unavailable.');
  api.close();
});
it('rejects hosted backends and production mode before subscribing or dispatching', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  expect(() => createCustomerSavingsDraftBrowser(scope, vi.fn())).toThrow(
    'Local savings drafts are unavailable.'
  );
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55431');
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => createCustomerSavingsDraftBrowser(scope, vi.fn())).toThrow(
    'Local savings drafts are unavailable.'
  );
  expect(mocks.subscribe).not.toHaveBeenCalled();
});
it('keeps stale status/code but redacts server error details', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
          error: 'private database detail',
        }),
        { status: 409 }
      )
    )
  );
  const api = createCustomerSavingsDraftBrowser(scope, vi.fn());
  await expect(api.accept(draft)).rejects.toMatchObject({
    code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
    status: 409,
  });
  api.close();
});
