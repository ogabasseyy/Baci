import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
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
      recordCrashBreadcrumb('bnpl:webview:load_start');
      input.setErrorMessage(null);
      input.scheduleLoadTimeout();
      input.setCheckoutStatus('loading');
    },
    handleLoadEnd: () => {
      recordCrashBreadcrumb('bnpl:webview:load_end');
      input.clearPendingLoadTimeout();
      input.setCheckoutStatus((currentStatus) =>
        currentStatus === 'error' || currentStatus === 'success'
          ? currentStatus
          : 'ready'
      );
    },
  };
}
