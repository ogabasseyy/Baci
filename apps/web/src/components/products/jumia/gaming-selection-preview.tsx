'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { UNREADABLE_GAMING_PREVIEW_CREATION_MESSAGE } from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

export function GamingSelectionPreview({ merchantId }: { merchantId: string }) {
  const [snapshot, setSnapshot] =
    useState<JumiaProductExportEligiblePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creationOutcomeUnknown, setCreationOutcomeUnknown] = useState(false);

  const loadPage = async (selectionId: string, page: number) => {
    setSnapshot(await eligiblePreviewRequest.page(selectionId, page));
  };
  const loadAnyCachedPreview = () =>
    gamingSelectionPreviewCache.loadFirstValid(merchantId, (selectionId) =>
      loadPage(selectionId, 1)
    );

  const createPreview = async (
    refresh = false,
    retryAfterUnreadableResponse = false
  ) => {
    if (creationOutcomeUnknown && !retryAfterUnreadableResponse) {
      setError(UNREADABLE_GAMING_PREVIEW_CREATION_MESSAGE);
      return;
    }
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
        (category) =>
          category.name?.replace(/^ +| +$/g, '').toLowerCase() === 'gaming'
      );
      if (categoryError) {
        if (
          !refresh &&
          !retryAfterUnreadableResponse &&
          (await loadAnyCachedPreview())
        )
          return;
        throw new Error('Unable to find the Gaming category. Please retry.');
      }
      if (!gamingCategories?.length) {
        if (refresh || retryAfterUnreadableResponse) {
          throw new Error(
            'An active Gaming category is required to refresh or retry this preview.'
          );
        }
        if (await loadAnyCachedPreview()) return;
        throw new Error(
          'An active Gaming category was not found for this store.'
        );
      }
      if (gamingCategories.length > 1) {
        if (!refresh && !retryAfterUnreadableResponse) {
          const loadedCached =
            await gamingSelectionPreviewCache.loadFirstValidForCategories(
              merchantId,
              gamingCategories.map((category) => category.id),
              (selectionId) => loadPage(selectionId, 1)
            );
          if (loadedCached) {
            return;
          }
        }
        throw new Error(
          'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
        );
      }
      const categoryId = gamingCategories[0].id;
      const cacheKey = `jumia-gaming-preview:${merchantId}:${categoryId}`;
      const cachedSelection = gamingSelectionPreviewCache.read(cacheKey);
      if (cachedSelection && !refresh && !retryAfterUnreadableResponse) {
        try {
          await loadPage(cachedSelection.selectionId, 1);
          return;
        } catch (cause) {
          if (!gamingSelectionPreviewCache.isRejected(cause)) throw cause;
          gamingSelectionPreviewCache.remove(cacheKey);
        }
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
          await eligiblePreviewRequest.errorMessage(
            response,
            'Unable to create a Gaming preview. Please retry.'
          )
        );
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        setCreationOutcomeUnknown(true);
        throw new Error(UNREADABLE_GAMING_PREVIEW_CREATION_MESSAGE);
      }
      if (
        !gamingSelectionPreviewCache.isRecord(result) ||
        !gamingSelectionPreviewCache.isSelectionId(result.selectionId)
      ) {
        setCreationOutcomeUnknown(true);
        throw new Error(UNREADABLE_GAMING_PREVIEW_CREATION_MESSAGE);
      }
      setCreationOutcomeUnknown(false);
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
        gamingSelectionPreviewCache.errorMessage(
          cause,
          'Unable to create a Gaming preview.'
        )
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
        gamingSelectionPreviewCache.errorMessage(
          cause,
          'Unable to load this Gaming preview.'
        )
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Gaming selection preview</p>
          <p className="text-xs text-muted-foreground">
            Review a frozen selection. Previewing does not submit products to
            Jumia.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => createPreview(false, creationOutcomeUnknown)}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading
              ? 'Loading…'
              : creationOutcomeUnknown
                ? 'Retry preview creation'
                : 'Create Gaming preview'}
          </Button>
          {snapshot ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => createPreview(true)}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? 'Loading…' : 'Refresh preview'}
            </Button>
          ) : null}
        </div>
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
                  {item.available &&
                  item.capturedSourceVersion !== item.currentSourceVersion ? (
                    <span className="text-xs text-amber-700">
                      Changed since preview; showing current details.
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || snapshot.page <= 1}
              onClick={() => goToPage(snapshot.page - 1)}
              className="w-full sm:w-auto"
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
              className="w-full sm:w-auto"
            >
              Next page
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
