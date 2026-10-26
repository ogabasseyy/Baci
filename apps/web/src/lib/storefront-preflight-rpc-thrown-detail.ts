import { boundedStorefrontPreflightRpcErrorDetail } from './storefront-preflight-rpc-error-detail';

export function getStorefrontPreflightRpcThrownErrorDetail(
  error: unknown
): string | undefined {
  if (error instanceof Error || error instanceof DOMException) {
    return boundedStorefrontPreflightRpcErrorDetail(error.name, error.message);
  }
  return undefined;
}
