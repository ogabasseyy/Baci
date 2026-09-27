/**
 * Native-shell bridge for BNPL provider lifecycle events. Extracted from
 * bnpl-launcher.tsx (300-line file limit): inside a native WebView the
 * shell records payment_started from bnpl_provider_opened and failures
 * from bnpl_provider_error, so the web attribution helpers no-op there.
 */

export type NativeBNPLBridgeGateway = 'credpal' | 'credit_direct' | 'klump';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

function postBridgeMessage(message: Record<string, string>): boolean {
  const bridge = window.ReactNativeWebView;
  if (typeof bridge?.postMessage !== 'function') {
    return false;
  }
  try {
    bridge.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

export function notifyNativeBnplProviderOpened(
  gateway: NativeBNPLBridgeGateway,
  orderId: string,
  reference?: string
): boolean {
  // Confirms the provider flow actually opened: the native shell records
  // payment_started from this signal, so initialization failures (order
  // lookup, SDK load, popup creation) never produce a start.
  return postBridgeMessage({
    gateway,
    orderId,
    ...(reference ? { reference } : {}),
    type: 'bnpl_provider_opened',
  });
}

export function notifyNativeBnplProviderError(
  gateway: NativeBNPLBridgeGateway,
  orderId: string,
  message: string,
  reference?: string
): boolean {
  // The provider opened (payment_started recorded natively) and then its
  // SDK failed: bridge the failure so the native funnel reaches
  // recordCheckoutFailure instead of leaving an unmatched start. The
  // native error view (with retry) replaces the WebView, so the caller
  // defers its own error UI when the bridge lands.
  return postBridgeMessage({
    gateway,
    orderId,
    message,
    ...(reference ? { reference } : {}),
    type: 'bnpl_provider_error',
  });
}

export function notifyNativeBnplClose(
  gateway: NativeBNPLBridgeGateway
): boolean {
  return postBridgeMessage({
    gateway,
    message:
      gateway === 'credit_direct'
        ? 'Credit Direct checkout closed'
        : gateway === 'credpal'
          ? 'CredPal checkout closed'
          : 'Klump checkout closed',
    type: 'bnpl_close',
  });
}

interface OpenedAttemptError {
  providerOpenedLaunchKeyRef: { current: string | null };
  launchKey: string;
  gateway: NativeBNPLBridgeGateway;
  orderId: string;
  message: string;
  reference?: string;
}

/**
 * Shared unmatched-start guard behind every provider onError: bridge only
 * when this attempt opened — a pre-popup SDK failure has no native
 * payment_started to match, so bridging it would record an unmatched
 * payment_failed. Unopened failures fall through to the local error UI.
 */
export function bridgeOpenedAttemptError({
  providerOpenedLaunchKeyRef,
  launchKey,
  gateway,
  orderId,
  message,
  reference,
}: OpenedAttemptError): boolean {
  return (
    providerOpenedLaunchKeyRef.current === launchKey &&
    notifyNativeBnplProviderError(gateway, orderId, message, reference)
  );
}
