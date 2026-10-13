import Link from 'next/link';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function CartNavigationStart() {
  return (
    <main>
      <h1>Storefront home fixture</h1>
      <Link href="/products/test-phone" prefetch={false}>
        View test phone
      </Link>
    </main>
  );
}
