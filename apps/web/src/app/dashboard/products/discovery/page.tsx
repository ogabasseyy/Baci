import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ensurePermission,
  isMerchantPermissionRedirectError,
} from '@/lib/merchant-server';
import { DiscoveryBackfillPanel } from './discovery-backfill-panel';

export const metadata = {
  title: 'Product search indexing | Baci',
};

export default async function DiscoveryBackfillPage() {
  let merchant: Awaited<ReturnType<typeof ensurePermission>>['merchant'];
  try {
    ({ merchant } = await ensurePermission('products', 'edit'));
  } catch (error) {
    if (isMerchantPermissionRedirectError(error))
      redirect('/dashboard/products');
    throw error;
  }
  if (merchant.slug !== 'ogabassey') notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link
        href="/dashboard/products"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to products
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Product search indexing</h1>
        <p className="text-muted-foreground">
          Build the Ogabassey catalog index for the ChatGPT search pilot. Only
          product name, brand, category, and description are sent to Gemini.
          This does not enable semantic search or change the storefront.
        </p>
      </div>
      <DiscoveryBackfillPanel merchantId={merchant.id} />
    </main>
  );
}
