import type { MerchantFeatureSource } from '@/lib/merchant-has-feature';
import type { CartMerchantContext } from './principal';

export interface CartRouteMerchant extends CartMerchantContext {
  customDomain: string | null;
}

export type MerchantResolutionError =
  | 'merchant_unresolved'
  | 'merchant_unavailable'
  | 'temporarily_unavailable';

export interface MerchantRpcClient {
  rpc(
    functionName: 'resolve_storefront_auth_merchant',
    args: { p_identifier: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ResolveCartMerchantDeps {
  rpcClient: MerchantRpcClient;
  resolveAlias: (slug: string) => Promise<string | null>;
  rootDomain?: string;
  /** Teardown-only: revocation stays possible after unpublishing. */
  allowUnpublished?: boolean;
  /** Pre-parsed merchantSlug hint from the JSON body, if any. */
  bodyHint?: string | null;
  /** Enrollment lookup; when provided, resolution fails closed unless
   * the merchant carries the shared_cart feature. */
  loadMerchantFeatures?: (
    merchantId: string
  ) => Promise<MerchantFeatureSource | null>;
}
