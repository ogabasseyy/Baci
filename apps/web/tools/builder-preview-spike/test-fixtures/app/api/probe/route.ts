// Disposable runtime probe: not an authorization gateway or production endpoint.
import { revalidateMerchantPublication } from '@/lib/cache-revalidation';

// Cache Components uses the default Node runtime; segment runtime is forbidden.
const runtime = 'nodejs';
export function POST() {
  revalidateMerchantPublication({
    merchantId: '10000000-0000-4000-8000-000000000001',
    canonicalMerchantSlug: 'task-zero-fixture',
    identifiers: ['task-zero-fixture'],
  });
  return Response.json({ ok: true, runtime, publicationCacheCalled: true });
}
