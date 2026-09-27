import type { BNPLCheckoutStatus } from './use-bnpl-checkout-controller';

export function createBNPLLoadHandlers(input: {
  clearPendingLoadTimeout: () => void;
  scheduleLoadTimeout: () => void;
  setCheckoutStatus: (
    status:
      | BNPLCheckoutStatus
      | ((current: BNPLCheckoutStatus) => BNPLCheckoutStatus)
  ) => void;
  setErrorMessage: (message: string | null) => void;
  statusRef: { current: BNPLCheckoutStatus };
}) {
  return {
    handleLoadStart: () => {
      if (
        input.statusRef.current === 'error' ||
        input.statusRef.current === 'success'
      )
        return;
      input.setErrorMessage(null);
      input.scheduleLoadTimeout();
      input.setCheckoutStatus('loading');
    },
    handleLoadEnd: () => {
      input.clearPendingLoadTimeout();
      input.setCheckoutStatus((currentStatus) =>
        currentStatus === 'error' || currentStatus === 'success'
          ? currentStatus
          : 'ready'
      );
    },
  };
}
