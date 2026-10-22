import type { NextRequest } from 'next/server';
import { BUILDER_ACCOUNT_LINKING_ENABLED } from '@/config/builder-linking';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { getOwnerPublicationRuntime } from '@/lib/website-builder/publication-runtime';

function handle(request: NextRequest) {
  const handler = getOwnerPublicationRuntime();
  if (
    !BUILDER_ACCOUNT_LINKING_ENABLED ||
    !BUILDER_PRIVATE_STORAGE_ENABLED ||
    !handler
  )
    return Response.json(
      { error: 'Publication approval is not enabled.' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
        },
      }
    );
  return handler(request);
}
export const GET = handle;
export const POST = handle;
