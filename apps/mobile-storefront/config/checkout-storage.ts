import { getOxygenStagingProfile } from '../lib/oxygen-staging-profile';

const prefix = getOxygenStagingProfile()?.storagePrefix ?? '';
export const CHECKOUT_INSTALLATION_STORAGE_KEY = `${prefix}checkout-installation-id-v1`;
export const CHECKOUT_GENERATION_STORAGE_KEY = `${prefix}checkout-generation-v1`;
export const CHECKOUT_AUTH_PARTITION_STORAGE_KEY = `${prefix}checkout-auth-partition-v1`;
export const CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY = `${prefix}checkout-purchase-tracking-v1`;
export const CHECKOUT_PENDING_REDVAULT_ORDER_STORAGE_KEY = `${prefix}checkout-pending-redvault-order-v1`;
export const CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY = `${prefix}checkout-attempt-credit-v1`;
export const CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY = `${prefix}checkout-idempotency-item-sort-v2`;
