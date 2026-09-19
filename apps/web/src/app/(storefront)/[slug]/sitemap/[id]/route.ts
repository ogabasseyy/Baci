import { headers } from 'next/headers';
import {
  createSitemapIndexResponse,
  createSitemapNotFoundResponse,
  createSitemapResponse,
  createSitemapUnavailableResponse,
  getNamedSitemapEntries,
  getSitemapIndexLinks,
  resolveStorefrontSitemapContextResult,
} from '../../sitemap-data';

// Region pinning lives in vercel.json `regions` (dub1) — `preferredRegion`
// is deprecated and removed.

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; id: string }> }
): Promise<Response> {
  const { id: rawId, slug } = await context.params;
  const id = rawId.replace(/\.xml$/i, '');
  const sitemapContextResult = await resolveStorefrontSitemapContextResult(
    await headers(),
    slug,
    request
  );

  if (sitemapContextResult.status !== 'found') {
    return sitemapContextResult.status === 'not-found'
      ? createSitemapNotFoundResponse()
      : createSitemapUnavailableResponse();
  }

  const { context: sitemapContext } = sitemapContextResult;

  if (id === 'root') {
    // Public /sitemap.xml rewrites here. Serve a sitemap index so each child
    // sitemap reports separately in Search Console and no URL is listed in
    // two submitted files.
    return createSitemapIndexResponse(
      await getSitemapIndexLinks(sitemapContext)
    );
  }

  const entries = await getNamedSitemapEntries(sitemapContext, id);
  return createSitemapResponse(entries);
}
