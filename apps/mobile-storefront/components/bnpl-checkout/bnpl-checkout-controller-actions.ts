import { isAllowedBnplPopupUrl, isTrustedBnplReturnUrl } from '@/lib/bnpl-url';
import {
  extractErrorFromUrl,
  extractReferenceFromUrl,
  isBNPLCheckoutExitUrl,
} from './bnpl-checkout.helpers';
import { logBNPLCheckoutDebug } from './bnpl-checkout-message-handler';
import { sanitizeBNPLDocumentUrl } from './bnpl-checkout-navigation';

type BNPLNavigationEffect =
  | {
      isPending: boolean;
      reference?: string | null;
      status: 'success';
    }
  | {
      errorMessage: string;
      status: 'error';
    }
  | {
      status: 'return-to-app';
    };

type BNPLNavigationEffectOptions = {
  apiBaseUrl?: string;
  merchantDomain?: string;
  merchantSlug?: string;
};

type NavigationMessageInput = {
  apiBaseUrl: string;
  merchantDomain?: string;
  merchantSlug?: string;
  url: string;
};

type PopupTargetInput = {
  apiBaseUrl: string;
  merchantDomain?: string;
  merchantSlug?: string;
  targetUrl?: string;
};

type BNPLPopupTargetAction =
  | {
      type: 'ignore';
    }
  | {
      targetUrl: string;
      type: 'untrusted';
    }
  | {
      targetUrl: string;
      type: 'load';
    };

export function extractBNPLProviderStatus(url: string): string | null {
  try {
    return new URL(url).searchParams.get('credpalStatus');
  } catch {
    return null;
  }
}

export function resolveBNPLNavigationUrlEffect(
  url: string,
  options: BNPLNavigationEffectOptions = {}
): BNPLNavigationEffect | null {
  if (url.includes('/order-success') || url.includes('success=true')) {
    return {
      // Accepted-but-pending provider results (CredPal `pending`) reach the
      // same success page but are not paid conversions.
      isPending: extractBNPLProviderStatus(url) === 'pending',
      reference: extractReferenceFromUrl(url),
      status: 'success',
    };
  }

  if (url.includes('/checkout') && url.includes('cancelled=true')) {
    return {
      status: 'return-to-app',
    };
  }

  if (url.includes('error=') || url.includes('/checkout?error')) {
    return {
      errorMessage:
        extractErrorFromUrl(url) || 'Payment failed. Please try again.',
      status: 'error',
    };
  }

  if (
    options.apiBaseUrl &&
    isBNPLCheckoutExitUrl({
      apiBaseUrl: options.apiBaseUrl,
      merchantDomain: options.merchantDomain,
      merchantSlug: options.merchantSlug,
      url,
    })
  ) {
    return {
      status: 'return-to-app',
    };
  }

  return null;
}

export function shouldHandleBNPLNavigationMessage({
  apiBaseUrl,
  merchantDomain,
  merchantSlug,
  url,
}: NavigationMessageInput) {
  const isTrusted = isTrustedBnplReturnUrl(
    url,
    apiBaseUrl,
    merchantSlug,
    merchantDomain
  );

  if (!isTrusted) {
    logBNPLCheckoutDebug('ignored untrusted navigation message', {
      merchantDomain,
      merchantSlug,
      url,
    });
  }

  return isTrusted;
}

export function resolveBNPLPopupTargetAction({
  apiBaseUrl,
  merchantDomain,
  merchantSlug,
  targetUrl,
}: PopupTargetInput): BNPLPopupTargetAction {
  const sanitizedTargetUrl = targetUrl
    ? sanitizeBNPLDocumentUrl(targetUrl)
    : '';

  if (
    !sanitizedTargetUrl ||
    sanitizedTargetUrl === 'about:blank' ||
    sanitizedTargetUrl.startsWith('about:blank#')
  ) {
    return { type: 'ignore' };
  }

  if (
    !isAllowedBnplPopupUrl(
      sanitizedTargetUrl,
      apiBaseUrl,
      merchantSlug,
      merchantDomain
    )
  ) {
    return {
      targetUrl: sanitizedTargetUrl,
      type: 'untrusted',
    };
  }

  return {
    targetUrl: sanitizedTargetUrl,
    type: 'load',
  };
}
