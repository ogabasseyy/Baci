'use client';

import { jumiaPreviewMessages } from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { fetchMatchingGamingCategories } from './fetch-matching-gaming-categories';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import {
  createGamingSelection,
  UnreadableSelectionCreationError,
} from './selection-create-request';
import { useGamingSelectionPreviewState } from './use-gaming-selection-preview-state';

type PreviewCreationAction = 'create' | 'refresh' | 'retry';

export function useGamingSelectionPreview(merchantId: string) {
  const {
    currentMerchantRef,
    snapshot,
    loading,
    error,
    creationOutcomeUnknown,
    isCurrentMerchant,
    setCreationState,
    setSnapshotForMerchant,
    setLoadingForMerchant,
    setErrorForMerchant,
  } = useGamingSelectionPreviewState(merchantId);

  const loadPage = async (
    owner: string,
    generation: number,
    selectionId: string,
    page: number
  ) => {
    const result = await eligiblePreviewRequest.page(owner, selectionId, page);
    if (!isCurrentMerchant(owner, generation)) {
      throw new Error('Gaming preview merchant changed while loading.');
    }
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
      setLoadingForMerchant(owner, generation, true);
      setErrorForMerchant(owner, generation, null);
      try {
        if (!(await loadAnyCachedPreview(owner, generation))) {
          setErrorForMerchant(
            owner,
            generation,
            jumiaPreviewMessages.unreadableCreation
          );
        }
      } catch (cause) {
        setErrorForMerchant(
          owner,
          generation,
          gamingSelectionPreviewCache.errorMessage(
            cause,
            jumiaPreviewMessages.unreadableCreation
          )
        );
      } finally {
        setLoadingForMerchant(owner, generation, false);
      }
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
      if (!isCurrentMerchant(owner, generation)) return;
      let loadedCachedSelection = false;
      finishCreation = await gamingSelectionPreviewCache.beginCreation(
        owner,
        retryAfterUnreadableResponse,
        refresh || retryAfterUnreadableResponse
          ? undefined
          : async () => {
              const cachedSelection =
                gamingSelectionPreviewCache.read(cacheKey);
              if (!cachedSelection) return false;
              try {
                await loadPage(
                  owner,
                  generation,
                  cachedSelection.selectionId,
                  1
                );
                loadedCachedSelection = true;
                return true;
              } catch (cause) {
                if (!isCurrentMerchant(owner, generation)) return true;
                if (!gamingSelectionPreviewCache.isRejected(cause)) throw cause;
                gamingSelectionPreviewCache.removeIfMatches(
                  cacheKey,
                  cachedSelection.selectionId
                );
                return false;
              }
            }
      );
      if (loadedCachedSelection) return;
      if (!finishCreation) {
        const uncertain =
          gamingSelectionPreviewCache.hasUncertainCreation(owner);
        if (uncertain && isCurrentMerchant(owner, generation)) {
          setCreationState({ merchantId: owner, value: true });
        }
        if (
          uncertain &&
          !retryAfterUnreadableResponse &&
          (await loadAnyCachedPreview(owner, generation))
        ) {
          return;
        }
        setErrorForMerchant(
          owner,
          generation,
          uncertain
            ? jumiaPreviewMessages.unreadableCreation
            : jumiaPreviewMessages.creationInFlight
        );
        return;
      }
      if (!isCurrentMerchant(owner, generation)) return;
      let createdSelection: Awaited<ReturnType<typeof createGamingSelection>>;
      try {
        createdSelection = await createGamingSelection(owner, categoryId);
      } catch (cause) {
        if (cause instanceof UnreadableSelectionCreationError) {
          updateCreationOutcome(owner, generation, true);
        }
        throw cause;
      }
      const persisted = gamingSelectionPreviewCache.write(cacheKey, {
        selectionId: createdSelection.selectionId,
        expiresAt: createdSelection.expiresAt,
      });
      updateCreationOutcome(owner, generation, !persisted);
      finishCreation();
      finishCreation = null;
      await loadPage(owner, generation, createdSelection.selectionId, 1);
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
