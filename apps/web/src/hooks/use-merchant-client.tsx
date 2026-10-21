'use client';

// Client-runtime re-exports for the merchant hook.
//
// Use this path from Client Components that need to consume the merchant
// hook. Dashboard/builder surfaces that mount the authenticated provider
// should import `MerchantProvider` from `@/hooks/merchant/merchant-provider`
// so storefront consumers of `useMerchant` / `useMerchantSafe` do not pull
// dashboard auth and Supabase client bundles into storefront chunks.

export { useMerchant, useMerchantSafe } from './merchant/use-merchant';
