import Link from 'next/link';
import '@/app/(storefront)/storefront-ogabassey-pdp-deferred.css';

export default function TestPhoneProduct() {
  return (
    <main>
      <h1>Test phone</h1>
      <Link href="/cart">View cart</Link>
    </main>
  );
}
