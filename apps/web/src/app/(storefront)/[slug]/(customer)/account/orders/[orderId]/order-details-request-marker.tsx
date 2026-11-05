import { connection } from 'next/server';

// This customer-specific route is request-bound. Keep the marker separate so
// storefront chrome and the order's loading UI can still prerender.
export async function OrderDetailsRequestMarker() {
  await connection();
  return null;
}
