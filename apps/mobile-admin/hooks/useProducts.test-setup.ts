import { vi } from 'vitest';

type ProductsDataModule = typeof import('./products-data');

const mocks = vi.hoisted(() => ({
  chainCalls: [] as Array<{ method: string; args: unknown[] }>,
  createProductRecord: vi.fn(),
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
  merchant: { id: 'merchant-1' } as { id: string } | null,
  fetchProductDetail: vi.fn(),
  infiniteQueryConfigs: [] as Array<{
    queryFn: (args: { pageParam?: number }) => Promise<unknown>;
    queryKey: readonly unknown[];
    staleTime?: number;
  }>,
  mutationConfigs: [] as Array<{
    mutationFn?: (variables: unknown) => unknown;
    onMutate?: (variables: unknown) => unknown;
    onSettled?: (
      data: unknown,
      error: unknown,
      variables: { productId: string; stock: number },
      context?: unknown
    ) => void;
    onSuccess?: (
      data: unknown,
      variables: Record<string, unknown>,
      context?: unknown
    ) => unknown;
  }>,
  updateProductStatus: vi.fn(),
  updateProductRecord: vi.fn(),
  productQueryResult: {
    count: 0,
    data: [] as unknown[],
    error: null as { message: string } | null,
  },
  queryClient: {
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
    invalidateQueries: vi.fn(),
    setQueriesData: vi.fn(),
    setQueryData: vi.fn(),
  },
  queryConfigs: [] as Array<{
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
    queryKey: readonly unknown[];
    staleTime?: number;
  }>,
  queryPromises: [] as Promise<unknown>[],
  rpc: vi.fn(),
}));

function makeProductQuery() {
  const chain: Record<string, unknown> = {};
  const passthrough =
    (method: string) =>
    (...args: unknown[]) => {
      mocks.chainCalls.push({ method, args });
      return chain;
    };

  for (const method of [
    'select',
    'eq',
    'is',
    'order',
    'range',
    'lte',
    'gt',
    'or',
  ]) {
    chain[method] = passthrough(method);
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  chain.then = (
    resolve: (value: {
      data: unknown[];
      count: number;
      error: { message: string } | null;
    }) => unknown
  ) => Promise.resolve(mocks.productQueryResult).then(resolve);
  return chain;
}

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: (config: {
    queryFn: (args: { pageParam?: number }) => Promise<unknown>;
    queryKey: readonly unknown[];
    staleTime?: number;
  }) => {
    mocks.infiniteQueryConfigs.push(config);
    mocks.queryPromises.push(config.queryFn({ pageParam: 0 }));
    return {};
  },
  useMutation: (config: {
    mutationFn?: (variables: unknown) => unknown;
    onMutate?: (variables: unknown) => unknown;
    onSettled?: (
      data: unknown,
      error: unknown,
      variables: { productId: string; stock: number },
      context?: unknown
    ) => void;
    onSuccess?: (
      data: unknown,
      variables: Record<string, unknown>,
      context?: unknown
    ) => unknown;
  }) => {
    const mutationConfig = {
      ...config,
      onSuccess: config.onSuccess
        ? (
            data: unknown,
            variables: Record<string, unknown>,
            context?: unknown
          ) =>
            config.onSuccess?.(
              data,
              variables,
              context ?? config.onMutate?.(variables)
            )
        : undefined,
    };
    mocks.mutationConfigs.push(mutationConfig);
    return {};
  },
  useQuery: (config: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
    queryKey: readonly unknown[];
    staleTime?: number;
  }) => {
    mocks.queryConfigs.push(config);
    mocks.queryPromises.push(config.queryFn());
    return {};
  },
  useQueryClient: () => mocks.queryClient,
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn().mockResolvedValue({
    category: { id: 'category-1', name: 'Phones', slug: 'phones' },
  }),
}));

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: mocks.invalidateStoreReadiness,
}));

vi.mock('@/lib/revalidate-storefront-products', () => ({
  revalidateStorefrontProducts: vi.fn(),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'branch', branchId: 'branch-1' } }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => makeProductQuery(), rpc: mocks.rpc },
}));

vi.mock('./product-detail-query', () => ({
  fetchProductDetail: mocks.fetchProductDetail,
}));

vi.mock('./product-save', () => ({
  createProductRecord: mocks.createProductRecord,
  updateProductRecord: mocks.updateProductRecord,
}));

vi.mock('./products-data', async (importOriginal) => {
  const actual = await importOriginal<ProductsDataModule>();
  return { ...actual, updateProductStatus: mocks.updateProductStatus };
});

export function resetUseProductsMocks() {
  mocks.chainCalls.length = 0;
  mocks.infiniteQueryConfigs.length = 0;
  mocks.mutationConfigs.length = 0;
  mocks.queryConfigs.length = 0;
  mocks.queryPromises.length = 0;
  mocks.fetchProductDetail.mockReset();
  mocks.merchant = { id: 'merchant-1' };
  mocks.productQueryResult = { count: 0, data: [], error: null };
  mocks.queryClient.cancelQueries.mockReset();
  mocks.queryClient.getQueriesData.mockReset();
  mocks.queryClient.getQueriesData.mockReturnValue([]);
  mocks.queryClient.invalidateQueries.mockReset();
  mocks.queryClient.setQueriesData.mockReset();
  mocks.queryClient.setQueryData.mockReset();
  mocks.rpc.mockReset();
  mocks.createProductRecord.mockReset();
  mocks.invalidateStoreReadiness.mockReset();
  mocks.invalidateStoreReadiness.mockResolvedValue(undefined);
  mocks.updateProductStatus.mockReset();
  mocks.updateProductRecord.mockReset();
}

export function getUseProductsMocks() {
  return mocks;
}
