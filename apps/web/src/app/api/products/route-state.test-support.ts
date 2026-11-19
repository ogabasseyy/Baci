import { vi } from 'vitest';

export const MERCHANT_ID = 'merchant-123';
export const USER_ID = 'user-123';
export const PRODUCT_ID = 'product-456';

export type MerchantContextMock = {
  merchantId: string;
  merchantSlug?: string;
  businessName: string;
  staffAccess: {
    isOwner: boolean;
    isStaff: boolean;
    role: string | null;
    permissions: Record<string, Record<string, boolean>>;
  };
};

type ProductsQueryChain = {
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
};

export const productRouteTestState: {
  authUser: unknown;
  csrfValid: boolean;
  existingProduct: unknown;
  insertError: unknown;
  insertResult: unknown;
  lastProductsQueryChain: ProductsQueryChain | null;
  merchant: unknown;
  merchantContext: { current: MerchantContextMock | null };
  products: unknown[];
  productsCount: number;
  productsError: unknown;
  rpcData: unknown;
  rpcError: unknown;
  variantsInsertError: unknown;
} = {
  authUser: { id: USER_ID },
  csrfValid: true,
  existingProduct: null,
  insertError: null,
  insertResult: null,
  lastProductsQueryChain: null,
  merchant: {
    id: MERCHANT_ID,
    business_name: 'Test Store',
    country: 'NG',
  },
  merchantContext: { current: null },
  products: [],
  productsCount: 0,
  productsError: null,
  rpcData: null,
  rpcError: null,
  variantsInsertError: null,
};

export function resetProductRouteTestState() {
  productRouteTestState.authUser = { id: USER_ID };
  productRouteTestState.csrfValid = true;
  productRouteTestState.existingProduct = null;
  productRouteTestState.insertError = null;
  productRouteTestState.insertResult = null;
  productRouteTestState.lastProductsQueryChain = null;
  productRouteTestState.merchant = {
    id: MERCHANT_ID,
    business_name: 'Test Store',
    country: 'NG',
  };
  productRouteTestState.merchantContext.current = {
    merchantId: MERCHANT_ID,
    merchantSlug: 'test-store',
    businessName: 'Test Store',
    staffAccess: {
      isOwner: true,
      isStaff: false,
      role: null,
      permissions: { full_access: { all: true } },
    },
  };
  productRouteTestState.products = [];
  productRouteTestState.productsCount = 0;
  productRouteTestState.productsError = null;
  productRouteTestState.rpcData = {
    inventoryValue: 50000,
    outOfStockCount: 0,
    categoryCount: 1,
  };
  productRouteTestState.rpcError = null;
  productRouteTestState.variantsInsertError = null;
}

export const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn(() => {
      const { authUser } = productRouteTestState;
      if (authUser === undefined) {
        return Promise.reject(new Error('Unexpected error'));
      }
      return Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: 'Not authenticated' },
      });
    }),
  },
  from: vi.fn((table: string) => {
    if (table === 'merchants') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({ data: productRouteTestState.merchant, error: null })
        ),
        single: vi.fn(() =>
          Promise.resolve({
            data: productRouteTestState.merchant,
            error: productRouteTestState.merchant
              ? null
              : { message: 'Not found' },
          })
        ),
      };
    }
    if (table === 'products' || table === 'merchant_products') {
      const chain = {
        select: vi.fn((columns: string) => {
          if (table === 'products' && /\bcost_price\b/.test(columns)) {
            throw new Error(
              'Product costs must be read through merchant_products'
            );
          }
          return chain;
        }),
        delete: vi.fn(() => {
          if (table === 'merchant_products')
            throw new Error('merchant_products is read-only');
          return chain;
        }),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        or: vi.fn(() => chain),
        gt: vi.fn(() => chain),
        in: vi.fn(() => chain),
        range: vi.fn(() =>
          Promise.resolve({
            data: productRouteTestState.productsError
              ? null
              : productRouteTestState.products,
            error: productRouteTestState.productsError,
            count: productRouteTestState.productsCount,
          })
        ),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: productRouteTestState.existingProduct,
            error: null,
          })
        ),
        insert: vi.fn(() => {
          if (table === 'merchant_products')
            throw new Error('merchant_products is read-only');
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: productRouteTestState.insertError
                    ? null
                    : productRouteTestState.insertResult,
                  error: productRouteTestState.insertError,
                })
              ),
            })),
          };
        }),
      };
      productRouteTestState.lastProductsQueryChain = chain;
      return chain;
    }
    if (table === 'product_variants') {
      return {
        insert: vi.fn(() =>
          Promise.resolve({ error: productRouteTestState.variantsInsertError })
        ),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };
  }),
  rpc: vi.fn(() =>
    Promise.resolve({
      data: productRouteTestState.rpcData,
      error: productRouteTestState.rpcError,
    })
  ),
  functions: {
    invoke: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
});
