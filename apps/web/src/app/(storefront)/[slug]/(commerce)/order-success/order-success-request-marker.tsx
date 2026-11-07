import { connection } from 'next/server';

// Confirmation belongs to the current request. Keep this marker separate from
// the page content so the static storefront shell can still render immediately.
export async function OrderSuccessRequestMarker() {
  await connection();
  return null;
}
