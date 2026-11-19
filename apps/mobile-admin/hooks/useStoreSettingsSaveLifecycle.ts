import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  type Dispatch,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  buildMerchantUpdatePayload,
  type StoreSettingsFormValues,
} from '@/components/store-settings/store-settings-payload';
import { validateStoreSettingsPhones } from '@/components/store-settings/validate-store-settings-phones';
import type { StatusModalState } from '@/components/ui/StatusModal';
import type { Merchant } from '@/hooks/useMerchant';
import {
  type MerchantIdentitySettingsReceipt,
  updateMerchantIdentitySettings,
} from '@/lib/merchant-settings';
import { invalidateStoreSettingsAfterSave } from '@/lib/store-settings-save-readiness';

type StoreSettingsSaveToken = {
  id: number;
  merchantId: string;
  revision: number;
};

type StoreSettingsSaveRequest = {
  expectedUpdatedAt: string | null | undefined;
  payload: ReturnType<typeof buildMerchantUpdatePayload>;
  token: StoreSettingsSaveToken;
};

type StoreSettingsSaveResult = StoreSettingsSaveToken & {
  receipt: MerchantIdentitySettingsReceipt | null;
};

export type RefreshedLocalStoreSettingsSave = MerchantIdentitySettingsReceipt;

type StoreSettingsRouter = {
  back: () => void;
};

type UseStoreSettingsSaveLifecycleArgs = {
  baseline: StoreSettingsFormValues | null;
  formValues: StoreSettingsFormValues;
  from?: string;
  getFormRevision: () => number;
  merchant: Pick<Merchant, 'id' | 'updated_at'> | null | undefined;
  onRefreshedLocalSave: (save: RefreshedLocalStoreSettingsSave) => void;
  queryClient: QueryClient;
  resetFormDirty: () => void;
  router: StoreSettingsRouter;
  setStatusModal: Dispatch<SetStateAction<StatusModalState>>;
  syncedMerchantUpdatedAt: string | null | undefined;
};

/** Saves settings without applying an old merchant's result to the active form. */
export function useStoreSettingsSaveLifecycle({
  baseline,
  formValues,
  from,
  getFormRevision,
  merchant,
  onRefreshedLocalSave,
  queryClient,
  resetFormDirty,
  router,
  setStatusModal,
  syncedMerchantUpdatedAt,
}: UseStoreSettingsSaveLifecycleArgs) {
  const merchantIdRef = useRef<string | null>(merchant?.id ?? null);
  const activeSaveTokenRef = useRef<StoreSettingsSaveToken | null>(null);
  const nextSaveTokenIdRef = useRef(0);
  const [pendingMerchantIds, setPendingMerchantIds] = useState(
    () => new Map<number, string>()
  );

  // Do not write this ref during render. An interrupted merchant switch must
  // not make the still-visible merchant's save result look stale.
  useLayoutEffect(() => {
    merchantIdRef.current = merchant?.id ?? null;
  }, [merchant?.id]);

  const markSavePending = (saveToken: StoreSettingsSaveToken) => {
    setPendingMerchantIds((previous) => {
      const next = new Map(previous);
      next.set(saveToken.id, saveToken.merchantId);
      return next;
    });
  };

  const markSaveSettled = (saveTokenId: number | undefined) => {
    if (saveTokenId === undefined) return;
    setPendingMerchantIds((previous) => {
      if (!previous.has(saveTokenId)) return previous;
      const next = new Map(previous);
      next.delete(saveTokenId);
      return next;
    });
  };

  const isCurrentSaveToken = (
    saveToken: StoreSettingsSaveToken | null | undefined
  ) =>
    Boolean(
      saveToken &&
        merchantIdRef.current === saveToken.merchantId &&
        getFormRevision() === saveToken.revision
    );

  const saveMutation = useMutation<
    StoreSettingsSaveResult,
    unknown,
    StoreSettingsSaveRequest | null
  >({
    mutationFn: async (request) => {
      if (!request) throw new Error('No merchant found');

      if (Object.keys(request.payload).length === 0) {
        return { ...request.token, receipt: null };
      }

      if (!request.expectedUpdatedAt) {
        throw new Error(
          'These settings need to be reloaded before they can be saved.'
        );
      }
      const receipt = await updateMerchantIdentitySettings({
        expectedUpdatedAt: request.expectedUpdatedAt,
        merchantId: request.token.merchantId,
        settings: request.payload,
      });
      return { ...request.token, receipt };
    },
    onSuccess: async (saveToken) => {
      try {
        try {
          await invalidateStoreSettingsAfterSave(
            queryClient,
            saveToken.merchantId
          );
        } catch (error) {
          console.warn('Store settings saved but cache refresh failed:', error);
        }
        if (
          saveToken.receipt &&
          merchantIdRef.current === saveToken.receipt.merchantId
        ) {
          onRefreshedLocalSave(saveToken.receipt);
        }
        if (!isCurrentSaveToken(saveToken)) {
          if (activeSaveTokenRef.current?.id === saveToken.id) {
            activeSaveTokenRef.current = null;
          }
          return;
        }
        resetFormDirty();
        if (from === 'setup') {
          router.back();
          return;
        }
        setStatusModal({
          visible: true,
          type: 'success',
          title: 'Success!',
          message: 'Store settings updated successfully.',
        });
      } finally {
        markSaveSettled(saveToken.id);
      }
    },
    onError: (error: unknown, request) => {
      const saveToken = request?.token;
      markSaveSettled(saveToken?.id);
      const isCurrentSave = isCurrentSaveToken(saveToken);
      if (activeSaveTokenRef.current?.id === saveToken?.id) {
        activeSaveTokenRef.current = null;
      }
      if (!isCurrentSave) return;
      console.error('Update error:', error);
      setStatusModal({
        visible: true,
        type: 'error',
        title: 'Update Failed',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update store settings',
      });
    },
  });

  const startSave = () => {
    if (!merchant?.id || !baseline) {
      saveMutation.mutate(null);
      return;
    }

    const payload = buildMerchantUpdatePayload(baseline, formValues);
    const phoneError = validateStoreSettingsPhones(payload);
    if (phoneError) {
      setStatusModal({
        visible: true,
        type: 'error',
        title: 'Check phone number',
        message: phoneError,
      });
      return;
    }

    const saveToken = {
      id: ++nextSaveTokenIdRef.current,
      merchantId: merchant.id,
      revision: getFormRevision(),
    };
    activeSaveTokenRef.current = saveToken;
    markSavePending(saveToken);
    saveMutation.mutate({
      expectedUpdatedAt: syncedMerchantUpdatedAt,
      payload,
      token: saveToken,
    });
  };

  const isSaving =
    merchant?.id !== undefined &&
    Array.from(pendingMerchantIds.values()).some(
      (pendingMerchantId) => pendingMerchantId === merchant.id
    );

  const handleCloseStatusModal = (statusModal: StatusModalState) => {
    if (statusModal.type === 'success' && statusModal.title === 'Success!') {
      setStatusModal((previous) => ({ ...previous, visible: false }));
      if (isCurrentSaveToken(activeSaveTokenRef.current)) router.back();
      activeSaveTokenRef.current = null;
      return;
    }
    setStatusModal((previous) => ({ ...previous, visible: false }));
  };

  return {
    handleCloseStatusModal,
    isSaving,
    startSave,
  };
}
