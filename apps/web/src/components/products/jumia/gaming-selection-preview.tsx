'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';

type EligibleItem = {
  id: string;
  available: boolean;
  unavailableReason: string | null;
  capturedSourceVersion: string;
  currentSourceVersion: string | null;
  product: { product?: { name?: string | null } } | null;
};

type EligiblePage = {
  selectionId: string;
  total: number;
  page: number;
  totalPages: number;
  legacyUnmappedCount: number;
  products: EligibleItem[];
};

const UPGRADE_REQUIRED_MESSAGE =
  'Marketplace sync requires an upgraded plan. Upgrade your plan to preview Jumia products.';

async function requestErrorMessage(response: Response, fallback: string) {
  if (response.status !== 402) return fallback;
  try {
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === 'object' &&
      'code' in payload &&
      payload.code === 'requires_upgrade'
    ) {
      return UPGRADE_REQUIRED_MESSAGE;
    }
  } catch {
    // Keep the user-facing fallback generic when the error body is malformed.
  }
  return fallback;
}

function parseEligiblePage(value: unknown): EligiblePage | null {
  if (!value || typeof value !== 'object') return null;
  if (
    !('selectionId' in value) ||
    typeof value.selectionId !== 'string' ||
    !('total' in value) ||
    typeof value.total !== 'number' ||
    !('page' in value) ||
    typeof value.page !== 'number' ||
    !('totalPages' in value) ||
    typeof value.totalPages !== 'number' ||
    !('legacyUnmappedCount' in value) ||
    typeof value.legacyUnmappedCount !== 'number' ||
    !('products' in value) ||
    !Array.isArray(value.products)
  )
    return null;
  const products: EligibleItem[] = [];
  for (const item of value.products) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !('available' in item) ||
      typeof item.available !== 'boolean' ||
      !('unavailableReason' in item) ||
      (item.unavailableReason !== null &&
        typeof item.unavailableReason !== 'string') ||
      !('capturedSourceVersion' in item) ||
      typeof item.capturedSourceVersion !== 'string' ||
      !('currentSourceVersion' in item) ||
      (item.currentSourceVersion !== null &&
        typeof item.currentSourceVersion !== 'string') ||
      !('product' in item) ||
      (item.product !== null && typeof item.product !== 'object')
    ) {
      return null;
    }
    products.push({
      id: item.id,
      available: item.available,
      unavailableReason: item.unavailableReason,
      capturedSourceVersion: item.capturedSourceVersion,
      currentSourceVersion: item.currentSourceVersion,
      product: item.product,
    });
  }
  return {
    selectionId: value.selectionId,
    total: value.total,
    page: value.page,
    totalPages: value.totalPages,
    legacyUnmappedCount: value.legacyUnmappedCount,
    products,
  };
}

export function GamingSelectionPreview({ merchantId }: { merchantId: string }) {
  const [snapshot, setSnapshot] = useState<EligiblePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = async (selectionId: string, page: number) => {
    const response = await fetch(
      `/api/marketplace/jumia/products/eligible?${new URLSearchParams({ selectionId, page: String(page) })}`
    );
    if (!response.ok) {
      throw new Error(
        await requestErrorMessage(
          response,
          'Unable to load this Gaming preview. Please retry.'
        )
      );
    }
    const parsed = parseEligiblePage(await response.json());
    if (!parsed)
      throw new Error(
        'Unable to read the Gaming preview. Please create it again.'
      );
    setSnapshot(parsed);
  };

  const createPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: categories, error: categoryError } = await createClient()
        .from('categories')
        .select('id')
        .eq('merchant_id', merchantId)
        .eq('is_active', true)
        .ilike('name', 'Gaming')
        .order('id', { ascending: true })
        .limit(2);
      if (categoryError || !categories?.length) {
        throw new Error(
          'An active Gaming category was not found for this store.'
        );
      }
      if (categories.length > 1) {
        throw new Error(
          'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
        );
      }
      const response = await fetchWithCsrf(
        '/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({ sourceCategoryId: categories[0].id }),
        }
      );
      if (!response.ok) {
        throw new Error(
          await requestErrorMessage(
            response,
            'Unable to create a Gaming preview. Please retry.'
          )
        );
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('selectionId' in result) ||
        typeof result.selectionId !== 'string'
      ) {
        throw new Error('Unable to read the Gaming preview. Please retry.');
      }
      await loadPage(result.selectionId, 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to create a Gaming preview.'
      );
    } finally {
      setLoading(false);
    }
  };

  const goToPage = async (page: number) => {
    if (!snapshot) return;
    setLoading(true);
    setError(null);
    try {
      await loadPage(snapshot.selectionId, page);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load this Gaming preview.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      aria-label="Gaming selection preview"
      className="grid gap-2 rounded-md border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Gaming selection preview</p>
          <p className="text-xs text-muted-foreground">
            Review a frozen selection. Previewing does not submit products to
            Jumia.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={createPreview}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Create Gaming preview'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p className="text-xs text-muted-foreground">
            {snapshot.total} products in this frozen selection
          </p>
          {snapshot.legacyUnmappedCount > 0 ? (
            <p className="text-sm text-amber-700" role="status">
              {snapshot.legacyUnmappedCount} active product
              {snapshot.legacyUnmappedCount === 1 ? ' uses' : 's use'} legacy
              Gaming labels and are not included. Assign them to the active
              Gaming category, then create a new preview.
            </p>
          ) : null}
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading products…
            </p>
          ) : null}
          {!loading && snapshot.products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products in this Gaming selection.
            </p>
          ) : null}
          <ul className="grid max-h-[40vh] gap-1 overflow-y-auto">
            {snapshot.products.map((item) => {
              const name =
                item.product?.product?.name?.trim() ||
                (item.available ? 'Unnamed product' : 'Unavailable product');
              const reason =
                item.unavailableReason?.replaceAll('_', ' ') ??
                'No longer eligible';
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                >
                  <span>{name}</span>
                  {!item.available ? (
                    <span className="text-xs text-destructive">{reason}</span>
                  ) : null}
                  {item.capturedSourceVersion !== item.currentSourceVersion ? (
                    <span className="text-xs text-amber-700">
                      Changed since preview; showing current details.
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={loading || snapshot.page <= 1}
              onClick={() => goToPage(snapshot.page - 1)}
            >
              Previous page
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {snapshot.page} of {snapshot.totalPages || 1}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={loading || snapshot.page >= snapshot.totalPages}
              onClick={() => goToPage(snapshot.page + 1)}
            >
              Next page
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
