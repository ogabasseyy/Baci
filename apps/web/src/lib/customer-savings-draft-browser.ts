import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import { customerSavingsDraftSchemas } from '@/schemas/customer-savings-draft';
import {
  type CustomerSavingsDraft,
  type CustomerSavingsDraftScope,
  customerSavingsDraftPublic as schemas,
} from '@/schemas/customer-savings-draft-public';

export function createCustomerSavingsDraftBrowser(
  input: CustomerSavingsDraftScope,
  onInvalidated: () => void
) {
  const scope = schemas.scope.parse(input);
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Local savings drafts are unavailable.');
  const supabase = createClient();
  const lifetime = new AbortController();
  const invalidate = () => {
    lifetime.abort();
    onInvalidated();
  };
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== scope.userId) invalidate();
  });
  async function verify() {
    lifetime.signal.throwIfAborted();
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.id !== scope.userId) {
      invalidate();
      throw new Error('Your session changed. Reopen your wallet.');
    }
    lifetime.signal.throwIfAborted();
  }
  async function request(path: string, body?: Record<string, unknown>) {
    await verify();
    const response = await fetchWithCsrf(
      `/api/storefront/customer/savings/drafts${path}`,
      {
        method: body ? 'POST' : 'GET',
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
      }
    );
    lifetime.signal.throwIfAborted();
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const code =
        payload &&
        typeof payload === 'object' &&
        'code' in payload &&
        typeof payload.code === 'string' &&
        /^SAVINGS_DRAFT_[A-Z_]+$/.test(payload.code)
          ? payload.code
          : undefined;
      throw Object.assign(new Error('Unable to load or save your draft.'), {
        code,
        status: response.status,
      });
    }
    const payload: unknown = await response.json();
    await verify();
    return payload;
  }
  return {
    close: () => {
      lifetime.abort();
      subscription.unsubscribe();
    },
    async catalogue(search = '', page = 0) {
      const query = schemas.catalogueQuery.parse({ search, page });
      await verify();
      let builder = supabase
        .from('products')
        .select('id, name, price, images, condition, has_variants')
        .eq('merchant_id', scope.merchantId)
        .eq('status', 'active')
        .order('name')
        .order('id')
        .range(query.page * 20, query.page * 20 + 19);
      if (query.search)
        builder = builder.ilike(
          'name',
          `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
        );
      const { data, error } = await builder.abortSignal(
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)])
      );
      if (error) throw new Error('Catalogue unavailable.');
      await verify();
      const products = schemas.catalogue.parse(data);
      if (products.length === 0) return products;
      const productIds = products.map((product) => product.id);
      const variantResult = await supabase
        .rpc(
          'get_storefront_product_variants',
          { p_product_ids: productIds },
          { count: 'exact' }
        )
        .range(0, 999)
        .abortSignal(
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)])
        );
      if (variantResult.error) throw new Error('Catalogue unavailable.');
      await verify();
      const variants = schemas.catalogueVariants.parse(variantResult.data);
      if (
        variantResult.count !== variants.length ||
        variants.some((variant) => !productIds.includes(variant.product_id))
      )
        throw new Error('Catalogue unavailable.');
      return products.map((product) => ({
        ...product,
        variants: variants
          .filter((variant) => variant.product_id === product.id)
          .map(({ product_id: _productId, ...variant }) => variant),
      }));
    },
    async list(requestId?: string) {
      const query = customerSavingsDraftSchemas.list.parse({
        merchantId: scope.merchantId,
        ...(requestId ? { requestId } : {}),
      });
      return schemas.list.parse(await request(`?${new URLSearchParams(query)}`))
        .drafts;
    },
    async create(selection: {
      productId: string;
      variantId: string | null;
      requestId: string;
    }) {
      const body = customerSavingsDraftSchemas.create.parse({
        merchantId: scope.merchantId,
        ...selection,
      });
      return schemas.result.parse(await request('', body)).draft;
    },
    async read(draftId: string) {
      const query = customerSavingsDraftSchemas.policy.parse({
        merchantId: scope.merchantId,
        draftId,
      });
      return schemas.result.parse(
        await request(`/policy?${new URLSearchParams(query)}`)
      ).draft;
    },
    async accept(draft: CustomerSavingsDraft) {
      const body = customerSavingsDraftSchemas.accept.parse({
        merchantId: scope.merchantId,
        draftId: draft.draftId,
        revisionId: draft.revisionId,
        termsVersion: draft.terms.version,
        termsHash: draft.terms.hash,
        accepted: true,
      });
      return schemas.result.parse(await request('/policy', body)).draft;
    },
  };
}
