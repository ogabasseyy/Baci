import type { ComponentProps, RefObject } from 'react';
import type { WebView } from 'react-native-webview';

export type WebViewErrorEvent = Parameters<
  NonNullable<ComponentProps<typeof WebView>['onError']>
>[0];

export type PaymentGatewayStatus =
  | 'loading'
  | 'ready'
  | 'processing'
  | 'held'
  | 'pending'
  | 'success'
  | 'error';

export type PaymentStatusSetter = (
  nextStatus:
    | PaymentGatewayStatus
    | ((currentStatus: PaymentGatewayStatus) => PaymentGatewayStatus)
) => void;

export interface PaymentGatewayRefs {
  copiedGatewayTextRef: RefObject<string | null>;
  isMountedRef: RefObject<boolean>;
  loadTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  navigationTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  paymentCompletionStartedRef: RefObject<boolean>;
  savingsAuthorizationAbortRef: RefObject<AbortController | null>;
  statusRef: RefObject<PaymentGatewayStatus>;
  vtuConfirmationTokenRef: RefObject<number>;
  webViewRef: RefObject<WebView | null>;
}
