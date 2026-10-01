import Image from '../opengraph-image-renderer';

// Region pinning lives in vercel.json `regions` (dub1, next to the Supabase
// primary in eu-west-1 / Dublin) — `preferredRegion` is deprecated and removed.

type RouteContext = {
  params: Promise<{ slug: string; postSlug: string }>;
};

export function GET(_request: Request, { params }: RouteContext) {
  return Image({ params });
}
