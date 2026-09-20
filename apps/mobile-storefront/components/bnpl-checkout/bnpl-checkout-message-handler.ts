export type BNPLWebViewMessageEvent = { nativeEvent: { data: string } };

export function logBNPLCheckoutDebug(eventName: string, details: unknown) {
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.NODE_ENV !== 'test'
  ) {
    console.info(`[BNPLCheckout] ${eventName}`, details);
  }
}

interface BNPLWebViewMessageHandlerOptions {
  onCloseMessage?: () => void;
  onNavigationMessage?: (url: string) => void;
  onProviderOpenedMessage?: (input: {
    gateway?: string;
    orderId?: string;
  }) => void;
  onProviderErrorMessage?: (input: {
    gateway?: string;
    orderId?: string;
    message?: string;
  }) => void;
}

function isProviderCloseSummary(summary: unknown) {
  if (!summary || typeof summary !== 'object') {
    return false;
  }

  const { message, name, status, type } = summary as Record<string, unknown>;
  return [message, name, status, type].some(
    (value) => typeof value === 'string' && value === 'checkout.widget.closed'
  );
}

function isBNPLCloseMessage(payload: Record<string, unknown>) {
  if (payload.type === 'bnpl_close') {
    return true;
  }

  if (payload.type !== 'bnpl_log') {
    return false;
  }

  if (
    payload.message === 'Credit Direct checkout closed' ||
    payload.message === 'Klump checkout closed'
  ) {
    return true;
  }

  return isProviderCloseSummary(payload.summary);
}

export function createBNPLWebViewMessageHandler(
  options: BNPLWebViewMessageHandlerOptions = {}
) {
  return (event: BNPLWebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as unknown;
      if (!data || typeof data !== 'object') {
        logBNPLCheckoutDebug('ignored primitive webview message', {
          data: event.nativeEvent.data,
        });
        return;
      }
      const payload = data as Record<string, unknown>;

      if (payload.type === 'navigation' && typeof payload.url === 'string') {
        logBNPLCheckoutDebug('diagnostic navigation message', {
          url: payload.url,
        });
        options.onNavigationMessage?.(payload.url);
      } else if (
        payload.type === 'bnpl_log' ||
        payload.type === 'bnpl_error_log' ||
        payload.type === 'bnpl_success' ||
        payload.type === 'bnpl_error' ||
        payload.type === 'bnpl_close' ||
        payload.type === 'bnpl_provider_opened' ||
        payload.type === 'bnpl_provider_error'
      ) {
        logBNPLCheckoutDebug('webview message', payload);
        if (isBNPLCloseMessage(payload)) {
          options.onCloseMessage?.();
        }
        if (payload.type === 'bnpl_provider_opened') {
          const gateway =
            typeof payload.gateway === 'string' ? payload.gateway : undefined;
          const orderId =
            typeof payload.orderId === 'string' ? payload.orderId : undefined;
          options.onProviderOpenedMessage?.({ gateway, orderId });
        }
        if (payload.type === 'bnpl_provider_error') {
          const gateway =
            typeof payload.gateway === 'string' ? payload.gateway : undefined;
          const orderId =
            typeof payload.orderId === 'string' ? payload.orderId : undefined;
          const message =
            typeof payload.message === 'string' ? payload.message : undefined;
          options.onProviderErrorMessage?.({ gateway, orderId, message });
        }
      }
    } catch {
      logBNPLCheckoutDebug('ignored non-json webview message', {
        data: event.nativeEvent.data,
      });
    }
  };
}
