import type { OgabasseyBlogLcpSnapshot } from './load-ogabassey-blog-lcp-snapshot';
import snapshotJson from './ogabassey-blog-lcp-snapshot.json';

// Must stay a synchronous JSON import. Top-level await of the uncached listing
// fetch postponed this module (and leaf loading.tsx) so the parent [slug] PPR
// slot painted "Loading storefront chrome" and hid the featured <picture>.
export const ogabasseyBlogLcpSnapshot: OgabasseyBlogLcpSnapshot = snapshotJson;
