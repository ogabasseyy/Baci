import { useEffect, useState } from 'react';
import {
  type CustomerPaymentMethod,
  listCustomerPaymentMethods,
} from '@/lib/customer-savings';
import type { SavingsSourceMode } from './start-savings.types';
import { getErrorMessage } from './start-savings-controller.utils';

type UseStartSavingsPaymentMethodsInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  sourceMode: SavingsSourceMode;
};

export function useStartSavingsPaymentMethods({
  activeMerchantId,
  activeMerchantSlug,
  sourceMode,
}: UseStartSavingsPaymentMethodsInput) {
  // Identity of the saved-card fetch; null when auto-debit is not selected.
  const fetchKey =
    sourceMode === 'auto_debit'
      ? JSON.stringify([activeMerchantId ?? null, activeMerchantSlug ?? null])
      : null;
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<
    CustomerPaymentMethod[]
  >([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<
    string | null
  >(null);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(
    null
  );
  const [isLoadingPaymentMethods, setIsLoadingPaymentMethods] = useState(
    fetchKey !== null
  );
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);

  // Adjust state inline during render (prev-prop comparison) instead of in an
  // effect, so consumers never see a stale frame between the two commits.
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey);
    setPaymentMethodsError(null);
    setSavedPaymentMethods([]);
    setSelectedPaymentMethodId(null);
    if (fetchKey === null) {
      setIsLoadingPaymentMethods(false);
    } else {
      setIsLoadingPaymentMethods(true);
    }
  }

  useEffect(() => {
    if (sourceMode !== 'auto_debit') {
      return;
    }
    let isCancelled = false;
    void listCustomerPaymentMethods({
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
    })
      .then((methods) => {
        if (isCancelled) {
          return;
        }
        setSavedPaymentMethods(methods);
        setSelectedPaymentMethodId((currentId) =>
          currentId && methods.some((method) => method.id === currentId)
            ? currentId
            : null
        );
      })
      .catch((error) => {
        if (!isCancelled) {
          setPaymentMethodsError(
            getErrorMessage(error, 'Unable to load saved cards.')
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingPaymentMethods(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMerchantId, activeMerchantSlug, sourceMode]);

  return {
    isLoadingPaymentMethods,
    paymentMethodsError,
    savedPaymentMethods,
    selectedPaymentMethodId,
    setPaymentMethodsError,
    setSelectedPaymentMethodId,
  };
}
