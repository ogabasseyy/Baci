'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import {
  type JumiaProductExportEligiblePage,
  jumiaProductExportEligiblePageSchema,
} from '@/schemas/jumia/eligible-page';

type CachedSelection = { selectionId: string; expiresAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const UPGRADE_REQUIRED_MESSAGE =
  'Marketplace sync requires an upgraded plan. Upgrade your plan to preview Jumia products.';

async function requestErrorMessage(response: Response, fallback: string) {
  if (response.status !== 402) return fallback;
  const payload: unknown = await response.json().catch(() => null);
  return isRecord(payload) && payload.code === 'requires_upgrade'
    ? UPGRADE_REQUIRED_MESSAGE
    : fallback;
}

export function GamingSelectionPreview({ merchantId }: { merchantId: string }) {
  const [snapshot, setSnapshot] =
    useState<JumiaProductExportEligiblePage | null>(null);
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
    const parsed = jumiaProductExportEligiblePageSchema.safeParse(
      await response.json()
    );
    if (!parsed.success)
      throw new Error(
        'Unable to read the Gaming preview. Please create it again.'
      );
    setSnapshot(parsed.data);
  };

  const createPreview = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const { data: categories, error: categoryError } = await createClient()
        .from('categories')
        .select('id, name')
        .eq('merchant_id', merchantId)
        .eq('is_active', true)
        .ilike('name', '%Gaming%')
        .order('id', { ascending: true })
        .limit(1000);
      const gamingCategories = categories?.filter(
        (category) => category.name?.trim().toLowerCase() === 'gaming'
      );
      if (categoryError || !gamingCategories?.length) {
        throw new Error(
          'An active Gaming category was not found for this store.'
        );
      }
      if (gamingCategories.length > 1) {
        throw new Error(
          'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
        );
      }
      const categoryId = gamingCategories[0].id;
      const cacheKey = `jumia-gaming-preview:${merchantId}:${categoryId}`;
      let cachedSelection: CachedSelection | null = null;
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem(cacheKey) ?? 'null'
        );
        if (
          isRecord(value) &&
          typeof value.selectionId === 'string' &&
          typeof value.expiresAt === 'string' &&
          Date.parse(value.expiresAt) > Date.now()
        ) {
          cachedSelection = {
            selectionId: value.selectionId,
            expiresAt: value.expiresAt,
          };
        } else {
          localStorage.removeItem(cacheKey);
        }
      } catch {
        // Ignore unavailable storage or malformed cached values.
      }
      if (cachedSelection && !refresh) {
        await loadPage(cachedSelection.selectionId, 1);
        return;
      }
      const response = await fetchWithCsrf(
        '/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({ sourceCategoryId: categoryId }),
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
      if (!isRecord(result) || typeof result.selectionId !== 'string') {
        throw new Error('Unable to read the Gaming preview. Please retry.');
      }
      if (
        typeof result.expiresAt === 'string' &&
        Number.isFinite(Date.parse(result.expiresAt))
      ) {
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              selectionId: result.selectionId,
              expiresAt: result.expiresAt,
            })
          );
        } catch {
          // Preview creation still works without local storage.
        }
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
          onClick={() => createPreview()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Create Gaming preview'}
        </Button>
        {snapshot ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => createPreview(true)}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh preview'}
          </Button>
        ) : null}
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
                (item.available
                  ? 'Unnamed product'
                  : `Unavailable product (${item.id})`);
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
