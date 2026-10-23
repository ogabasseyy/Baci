'use client';

import { useEffect, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { jumiaProductExportSelectionCreateResponseSchema } from '@/schemas/jumia/product-export-selection-create-response';
import { jumiaPreviewMessages } from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { fetchMatchingGamingCategories } from './fetch-matching-gaming-categories';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { useGamingSelectionPreviewGeneration } from './use-gaming-selection-preview-generation';

type PreviewCreationAction = 'create' | 'refresh' | 'retry';
type MerchantValue<T> = { merchantId: string; value: T };

export function useGamingSelectionPreview(merchantId: string) {
  const currentMerchantRef = useGamingSelectionPreviewGeneration(merchantId);
  const [snapshotState, setSnapshotState] =
    useState<MerchantValue<JumiaProductExportEligiblePage> | null>(null);
  const [loadingState, setLoadingState] =
    useState<MerchantValue<boolean> | null>(null);
  const [errorState, setErrorState] = useState<MerchantValue<
    string | null
  > | null>(null);
  const [creationState, setCreationState] =
    useState<MerchantValue<boolean> | null>(null);
  const snapshot =
    snapshotState?.merchantId === merchantId ? snapshotState.value : null;
  const loading = loadingState?.merchantId === merchantId && loadingState.value;
  const error = errorState?.merchantId === merchantId ? errorState.value : null;
  const creationOutcomeUnknown =
    creationState?.merchantId === merchantId ? creationState.value : false;
  const isCurrentMerchant = (owner: string, generation: number) =>
    currentMerchantRef.current.merchantId === owner &&
    currentMerchantRef.current.generation === generation;

  const setSnapshotForMerchant = (
    owner: string,
    generation: number,
    value: JumiaProductExportEligiblePage
  ) => {
    if (isCurrentMerchant(owner, generation)) {
      setSnapshotState({ merchantId: owner, value });
    }
  };
  const setLoadingForMerchant = (
    owner: string,
    generation: number,
    value: boolean
  ) => {
    if (isCurrentMerchant(owner, generation)) {
      setLoadingState({ merchantId: owner, value });
    }
  };
  const setErrorForMerchant = (
    owner: string,
    generation: number,
    value: string | null
  ) => {
    if (isCurrentMerchant(owner, generation)) {
      setErrorState({ merchantId: owner, value });
    }
  };

  useEffect(() => {
    setSnapshotState(null);
    setLoadingState(null);
    setErrorState(null);
    setCreationState({
      merchantId,
      value: gamingSelectionPreviewCache.hasUncertainCreation(merchantId),
    });
  }, [merchantId]);

  useEffect(
    () =>
      gamingSelectionPreviewCache.subscribeToUncertainCreationClear(
        merchantId,
        () => setCreationState({ merchantId, value: false })
      ),
    [merchantId]
  );

  const loadPage = async (
    owner: string,
    generation: number,
    selectionId: string,
    page: number
  ) => {
    const result = await eligiblePreviewRequest.page(owner, selectionId, page);
    setSnapshotForMerchant(owner, generation, result);
  };
  const loadAnyCachedPreview = (owner: string, generation: number) =>
    gamingSelectionPreviewCache.loadFirstValid(owner, (selectionId) =>
      loadPage(owner, generation, selectionId, 1)
    );

  const updateCreationOutcome = (
    owner: string,
    generation: number,
    unknown: boolean
  ) => {
    if (unknown) gamingSelectionPreviewCache.markUncertainCreation(owner);
    else gamingSelectionPreviewCache.clearUncertainCreation(owner);
    if (isCurrentMerchant(owner, generation)) {
      setCreationState({ merchantId: owner, value: unknown });
    }
  };

  const createPreview = async (action: PreviewCreationAction = 'create') => {
    const owner = merchantId;
    const generation = currentMerchantRef.current.generation;
    const refresh = action === 'refresh';
    const retryAfterUnreadableResponse = action === 'retry';
    const uncertainCreation =
      creationOutcomeUnknown ||
      gamingSelectionPreviewCache.hasUncertainCreation(owner);
    if (gamingSelectionPreviewCache.hasCreationInFlight(owner)) {
      setErrorForMerchant(
        owner,
        generation,
        jumiaPreviewMessages.creationInFlight
      );
      return;
    }
    if (uncertainCreation && !retryAfterUnreadableResponse) {
      setCreationState({ merchantId: owner, value: true });
      setErrorForMerchant(
        owner,
        generation,
        jumiaPreviewMessages.unreadableCreation
      );
      return;
    }
    setLoadingForMerchant(owner, generation, true);
    setErrorForMerchant(owner, generation, null);
    let finishCreation: (() => void) | null = null;
    try {
      const { data: categories, error: categoryError } =
        await fetchMatchingGamingCategories(owner);
      if (!isCurrentMerchant(owner, generation)) return;
      const gamingCategories = categories?.filter(
        (category) =>
          category.name?.replace(/^ +| +$/g, '').toLowerCase() === 'gaming'
      );
      if (categoryError) {
        if (
          !refresh &&
          !retryAfterUnreadableResponse &&
          (await loadAnyCachedPreview(owner, generation))
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
        if (await loadAnyCachedPreview(owner, generation)) return;
        throw new Error(
          'An active Gaming category was not found for this store.'
        );
      }
      if (gamingCategories.length > 1) {
        if (!refresh && !retryAfterUnreadableResponse) {
          const loadedCached =
            await gamingSelectionPreviewCache.loadFirstValidForCategories(
              owner,
              gamingCategories.map((category) => category.id),
              (selectionId) => loadPage(owner, generation, selectionId, 1)
            );
          if (loadedCached) return;
        }
        throw new Error(
          'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
        );
      }
      const categoryId = gamingCategories[0].id;
      const cacheKey = gamingSelectionPreviewCache.key(owner, categoryId);
      const cachedSelection = gamingSelectionPreviewCache.read(cacheKey);
      if (cachedSelection && !refresh && !retryAfterUnreadableResponse) {
        try {
          await loadPage(owner, generation, cachedSelection.selectionId, 1);
          return;
        } catch (cause) {
          if (!gamingSelectionPreviewCache.isRejected(cause)) throw cause;
          gamingSelectionPreviewCache.remove(cacheKey);
        }
      }
      if (!isCurrentMerchant(owner, generation)) return;
      finishCreation = gamingSelectionPreviewCache.beginCreation(owner);
      if (!finishCreation) {
        setErrorForMerchant(
          owner,
          generation,
          jumiaPreviewMessages.creationInFlight
        );
        return;
      }
      let response: Response;
      try {
        response = await fetchWithCsrf(
          '/api/marketplace/jumia/products/selections',
          {
            method: 'POST',
            body: JSON.stringify({
              sourceCategoryId: categoryId,
              merchantId: owner,
            }),
          }
        );
      } catch {
        updateCreationOutcome(owner, generation, true);
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
      if (!response.ok) {
        if (response.status >= 500) {
          updateCreationOutcome(owner, generation, true);
          throw new Error(jumiaPreviewMessages.unreadableCreation);
        }
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
        updateCreationOutcome(owner, generation, true);
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
      const parsedCreation =
        jumiaProductExportSelectionCreateResponseSchema.safeParse(result);
      if (!parsedCreation.success) {
        updateCreationOutcome(owner, generation, true);
        throw new Error(jumiaPreviewMessages.unreadableCreation);
      }
      updateCreationOutcome(owner, generation, false);
      gamingSelectionPreviewCache.write(cacheKey, {
        selectionId: parsedCreation.data.selectionId,
        expiresAt: parsedCreation.data.expiresAt,
      });
      finishCreation();
      finishCreation = null;
      await loadPage(owner, generation, parsedCreation.data.selectionId, 1);
    } catch (cause) {
      setErrorForMerchant(
        owner,
        generation,
        gamingSelectionPreviewCache.errorMessage(
          cause,
          'Unable to create a Gaming preview.'
        )
      );
    } finally {
      finishCreation?.();
      setLoadingForMerchant(owner, generation, false);
    }
  };

  const goToPage = async (page: number) => {
    if (!snapshot) return;
    const owner = merchantId;
    const generation = currentMerchantRef.current.generation;
    setLoadingForMerchant(owner, generation, true);
    setErrorForMerchant(owner, generation, null);
    try {
      await loadPage(owner, generation, snapshot.selectionId, page);
    } catch (cause) {
      setErrorForMerchant(
        owner,
        generation,
        gamingSelectionPreviewCache.errorMessage(
          cause,
          'Unable to load this Gaming preview.'
        )
      );
    } finally {
      setLoadingForMerchant(owner, generation, false);
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
