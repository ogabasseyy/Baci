import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

type CapturedQueryConfig = {
  queryFn?: () => Promise<unknown>;
  queryKey: readonly unknown[];
};

const queryMock = vi.hoisted(() => ({
  configs: [] as CapturedQueryConfig[],
}));

const supabaseMock = vi.hoisted(() => {
  type QueryResult = {
    data: unknown[] | null;
    error: { message: string } | null;
  };
  type RpcResult = {
    data: unknown[] | null;
    error: { message: string } | null;
  };
  type QueryRecord = {
    eq: ReturnType<typeof vi.fn>;
    from: string;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  const defaultRpcResult: RpcResult = { data: null, error: null };
  const results = new Map<string, QueryResult>();
  const queries: QueryRecord[] = [];
  const rpc = vi.fn((_functionName?: string) =>
    Promise.resolve(defaultRpcResult)
  );

  function createQuery(table: string) {
    const query = {
      eq: vi.fn(),
      from: table,
      in: vi.fn(),
      is: vi.fn(),
      limit: vi.fn(),
      neq: vi.fn(),
      order: vi.fn(),
      or: vi.fn(),
      select: vi.fn(),
      // biome-ignore lint/suspicious/noThenProperty: mocks the thenable Supabase query builder chain
      then: (
        resolve: (result: QueryResult) => unknown,
        reject?: (error: unknown) => unknown
      ) =>
        Promise.resolve(results.get(table) ?? { data: [], error: null }).then(
          resolve,
          reject
        ),
      update: vi.fn(),
    };

    query.eq.mockImplementation(() => query);
    query.in.mockImplementation(() => query);
    query.is.mockImplementation(() => query);
    query.limit.mockImplementation(() => query);
    query.neq.mockImplementation(() => query);
    query.order.mockImplementation(() => query);
    query.or.mockImplementation(() => query);
    query.select.mockImplementation(() => query);
    query.update.mockImplementation(() => query);

    queries.push(query);
    return query;
  }

  return {
    from: vi.fn(createQuery),
    queries,
    reset: () => {
      queries.length = 0;
      results.clear();
      rpc.mockReset();
      rpc.mockImplementation((_functionName?: string) =>
        Promise.resolve(defaultRpcResult)
      );
    },
    rpc,
    setResult: (table: string, result: QueryResult) => {
      results.set(table, result);
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: supabaseMock.from,
    rpc: supabaseMock.rpc,
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  );

  return {
    ...actual,
    useMutation: vi.fn((config) => config),
    useQuery: vi.fn((config: CapturedQueryConfig) => {
      queryMock.configs.push(config);
      return {};
    }),
    useQueryClient: () => queryClientMock,
  };
});

import { useUnlinkedOrderItemReconciliation } from './useUnlinkedOrderItemReconciliation';

type Candidate = {
  name: string;
  parentName: string | null;
  productId: string;
  variantId: string | null;
};

type HookState = {
  keepCustomMutation: {
    mutationFn: (input: { orderItemId: string }) => Promise<void>;
    onSuccess: () => void;
  };
  linkItemMutation: {
    mutationFn: (input: {
      orderItemId: string;
      productId: string;
      variantId: string | null;
    }) => Promise<void>;
    onSuccess: () => void;
  };
};

function getHookState() {
  // biome-ignore lint/correctness/useHookAtTopLevel: test helper invokes the hook outside a component render; @tanstack/react-query hooks are mocked as plain config-capturing functions above, so no real React hook state is involved
  return useUnlinkedOrderItemReconciliation() as unknown as HookState;
}

async function runProductCandidatesQuery() {
  getHookState();

  const config = queryMock.configs.find(
    (entry) => entry.queryKey[0] === 'transaction-reconciliation-products'
  );

  if (!config?.queryFn) {
    throw new Error('Product candidates query config was not captured');
  }

  return (await config.queryFn()) as Candidate[];
}

describe('useUnlinkedOrderItemReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClientMock.invalidateQueries.mockClear();
    queryMock.configs.length = 0;
    supabaseMock.reset();
  });

  it('fetches product and variant candidates scoped to the active merchant', async () => {
    supabaseMock.setResult('order_items', {
      data: [
        {
          id: 'item-1',
          name: 'iPhone 11 Pro 64GB Premium Used [IMEI: 353232106161443]',
          price: 180000,
        },
      ],
      error: null,
    });
    supabaseMock.rpc.mockImplementation((functionName?: string) => {
      if (functionName === 'search_products_v2') {
        return Promise.resolve({
          data: [{ product_id: 'product-1', relevance: 1, total_count: 1 }],
          error: null,
        });
      }

      return Promise.resolve({ data: null, error: null });
    });
    supabaseMock.setResult('products', {
      data: [
        {
          id: 'product-1',
          name: 'iPhone 11 Pro',
          price: 450000,
          status: 'active',
        },
      ],
      error: null,
    });
    supabaseMock.setResult('product_variants', {
      data: [
        {
          attributes: { storage: '64GB' },
          condition: null,
          id: 'variant-1',
          price_override: 180000,
          products: {
            id: 'product-1',
            merchant_id: 'merchant-1',
            name: 'iPhone 11 Pro',
            price: 450000,
            status: 'active',
          },
        },
      ],
      error: null,
    });

    const candidates = await runProductCandidatesQuery();

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'iPhone 11 Pro',
          productId: 'product-1',
          variantId: null,
        }),
        expect.objectContaining({
          name: '64GB',
          parentName: 'iPhone 11 Pro',
          productId: 'product-1',
          variantId: 'variant-1',
        }),
      ])
    );

    const variantQuery = supabaseMock.queries.find(
      (query) => query.from === 'product_variants'
    );
    const productQuery = supabaseMock.queries.find(
      (query) => query.from === 'products'
    );
    expect(productQuery?.or).not.toHaveBeenCalledWith(
      'status.neq.archived,status.is.null'
    );
    expect(variantQuery?.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(variantQuery?.eq).toHaveBeenCalledWith(
      'products.merchant_id',
      'merchant-1'
    );
    expect(variantQuery?.in).toHaveBeenCalledWith('product_id', ['product-1']);
    expect(variantQuery?.limit).not.toHaveBeenCalled();
  });

  it('limits concurrent product searches when building reconciliation candidates', async () => {
    const itemCount = 9;
    let currentSearches = 0;
    let maxConcurrentSearches = 0;

    supabaseMock.setResult('order_items', {
      data: Array.from({ length: itemCount }, (_, index) => ({
        id: `item-${index + 1}`,
        name: `Unique Reconciliation Product ${index + 1}`,
        price: 1000 + index,
      })),
      error: null,
    });
    supabaseMock.rpc.mockImplementation((functionName?: string) => {
      if (functionName !== 'search_products_v2') {
        return Promise.resolve({ data: null, error: null });
      }

      currentSearches += 1;
      maxConcurrentSearches = Math.max(maxConcurrentSearches, currentSearches);

      return Promise.resolve().then(() => {
        currentSearches -= 1;
        return { data: [], error: null };
      });
    });

    await runProductCandidatesQuery();

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(itemCount);
    expect(maxConcurrentSearches).toBeLessThanOrEqual(4);
  });
});
