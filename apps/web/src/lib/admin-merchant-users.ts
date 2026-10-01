// Kept as a compatibility export while merchant detail moves to the bounded
// platform-admin read model. This module must never issue tenant-table reads.
export { getAdminMerchant360 as getAdminMerchantUserDirectory } from '@/lib/admin-merchant-360';
