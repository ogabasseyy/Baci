import { fetchWithCsrf } from '@/lib/api-client';
import { JumiaPartialUpdateError } from './jumia-partial-update-error';

export interface JumiaOverridesState {
  price: string;
  salePrice: string;
  saleStart: string;
  saleEnd: string;
  isActive: boolean;
  syncInventory: boolean;
  syncPrice: boolean;
}

interface JumiaUpdateResponse {
  success?: boolean;
  errors?: unknown;
  error?: unknown;
  feedIds?: unknown;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

// Module-scope helper so the component body stays free of try/finally and
// throw-inside-try statements that block React Compiler memoization. A 200
// with success:false means Jumia accepted the feed but local persistence
// failed, so the caller surfaces the error instead of reporting success.
export async function saveJumiaOverrides(
  productId: string,
  integrationId: string,
  overrides: JumiaOverridesState
): Promise<void> {
  const response = await fetchWithCsrf(
    '/api/marketplace/jumia/products/update',
    {
      method: 'POST',
      body: JSON.stringify({
        productId,
        integrationId,
        overrides: {
          jumia_price: overrides.price
            ? Number.parseFloat(overrides.price)
            : null,
          jumia_sale_price: overrides.salePrice
            ? Number.parseFloat(overrides.salePrice)
            : null,
          jumia_sale_start: overrides.saleStart || null,
          jumia_sale_end: overrides.saleEnd || null,
          is_active: overrides.isActive,
          sync_inventory: overrides.syncInventory,
          sync_price: overrides.syncPrice,
        },
      }),
    }
  );

  if (!response.ok) {
    const errData = (await response.json()) as JumiaUpdateResponse;
    throw new Error(
      typeof errData.error === 'string'
        ? errData.error
        : 'Failed to update overrides'
    );
  }

  const data = (await response.json()) as JumiaUpdateResponse;
  if (data?.success === false) {
    const errors = toStringList(data.errors);
    throw new JumiaPartialUpdateError(
      errors.length > 0 ? errors.join(' ') : 'Failed to update overrides',
      toStringList(data.feedIds)
    );
  }
}
