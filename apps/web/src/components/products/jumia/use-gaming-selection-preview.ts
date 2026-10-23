'use client';

import { useEffect, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { jumiaPreviewMessages } from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

type PreviewCreationAction = 'create' | 'refresh' | 'retry';
const CATEGORY_PAGE_SIZE = 1000;

async function fetchMatchingCategories(merchantId: string) {
  const categories: { id: string; name: string | null }[] = [];
  const client = createClient();
  for (let start = 0; ; start += CATEGORY_PAGE_SIZE) {
    const { data, error } = await client
      .from('categories')
      .select('id, name')
      .eq('merchant_id', merchantId)
      .eq('is_active', true)
      .ilike('name', '%Gaming%')
      .order('id', { ascending: true })
      .range(start, start + CATEGORY_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    categories.push(...(data ?? []));
    if (!data || data.length < CATEGORY_PAGE_SIZE) {
      return { data: categories, error: null };
    }
  }
}

export function useGamingSelectionPreview(merchantId: string) {
  const [snapshot, setSnapshot] =
    useState<JumiaProductExportEligiblePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creationOutcomeUnknown, setCreationOutcomeUnknown] = useState(false);

  useEffect(() => {
    setCreationOutcomeUnknown(
      gamingSelectionPreviewCache.hasUncertainCreation(merchantId)
    );
  }, [merchantId]);

  const loadPage = async (selectionId: string, page: number) => {
    setSnapshot(await eligiblePreviewRequest.page(selectionId, page));
  };
  const loadAnyCachedPreview = () =>
    gamingSelectionPreviewCache.loadFirstValid(merchantId, (selectionId) =>
      loadPage(selectionId, 1)
    );

  const markCreationOutcomeUnknown = () => {
    gamingSelectionPreviewCache.markUncertainCreation(merchantId);
    setCreationOutcomeUnknown(true);
  };
  const clearCreationOutcomeUnknown = () => {
    gamingSelectionPreviewCache.clearUncertainCreation(merchantId);
    setCreationOutcomeUnknown(false);
  };

  const createPreview = async (action: PreviewCreationAction = 'create') => {
    const refresh = action === 'refresh';
    const retryAfterUnreadableResponse = action === 'retry';
    const uncertainCreation =
      creationOutcomeUnknown ||
      gamingSelectionPreviewCache.hasUncertainCreation(merchantId);
    if (uncertainCreation && !retryAfterUnreadableResponse) {
      setCreationOutcomeUnknown(true);
      setError(jumiaPreviewMessages.unreadableCreation);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: categories, error: categoryError } =
        await fetchMatchingCategories(merchantId);
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
          if (loadedCached) return;
        }
        throw new Error(
          'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
        );
      }
      const categoryId = gamingCategories[0].id;
      const cacheKey = gamingSelectionPreviewCache.key(merchantId, categoryId);
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
      let response: Response;
      try {
        response = await fetchWithCsrf(
          '/api/marketplace/jumia/products/selections',
          {
            method: 'POST',
            body: JSON.stringify({ sourceCategoryId: categoryId }),
          }
        );
      } catch {
        markCreationOutcomeUnknown();
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
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
        markCreationOutcomeUnknown();
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
      if (
        !gamingSelectionPreviewCache.isRecord(result) ||
        !gamingSelectionPreviewCache.isSelectionId(result.selectionId) ||
        typeof result.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(result.expiresAt)) ||
        Date.parse(result.expiresAt) <= Date.now()
      ) {
        markCreationOutcomeUnknown();
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
      clearCreationOutcomeUnknown();
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

  return {
    snapshot,
    loading,
    error,
    creationOutcomeUnknown,
    createPreview,
    goToPage,
  };
}
