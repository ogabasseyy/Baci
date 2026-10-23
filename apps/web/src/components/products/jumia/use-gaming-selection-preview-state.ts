'use client';

import { useEffect, useState } from 'react';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { useGamingSelectionPreviewGeneration } from './use-gaming-selection-preview-generation';

type MerchantValue<T> = { merchantId: string; value: T };

export function useGamingSelectionPreviewState(merchantId: string) {
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

  return {
    currentMerchantRef,
    snapshot,
    loading,
    error,
    creationOutcomeUnknown,
    isCurrentMerchant,
    setCreationState,
    updateCreationOutcome: (
      owner: string,
      generation: number,
      unknown: boolean
    ) => {
      if (unknown) gamingSelectionPreviewCache.markUncertainCreation(owner);
      else gamingSelectionPreviewCache.clearUncertainCreation(owner);
      if (isCurrentMerchant(owner, generation)) {
        setCreationState({ merchantId: owner, value: unknown });
      }
    },
    setSnapshotForMerchant: (
      owner: string,
      generation: number,
      value: JumiaProductExportEligiblePage
    ) => {
      if (isCurrentMerchant(owner, generation)) {
        setSnapshotState({ merchantId: owner, value });
      }
    },
    setLoadingForMerchant: (
      owner: string,
      generation: number,
      value: boolean
    ) => {
      if (isCurrentMerchant(owner, generation)) {
        setLoadingState({ merchantId: owner, value });
      }
    },
    setErrorForMerchant: (
      owner: string,
      generation: number,
      value: string | null
    ) => {
      if (isCurrentMerchant(owner, generation)) {
        setErrorState({ merchantId: owner, value });
      }
    },
  };
}
