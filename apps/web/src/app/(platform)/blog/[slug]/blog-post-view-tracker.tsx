'use client';

import { useEffect } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';

interface BlogPostViewTrackerProps {
  slug: string;
}

export function BlogPostViewTracker({ slug }: BlogPostViewTrackerProps) {
  useEffect(() => {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedSlug) {
      return;
    }

    void fetchWithCsrf('/api/blog/posts', {
      body: JSON.stringify({ slug: normalizedSlug }),
      cache: 'no-store',
      keepalive: true,
      method: 'POST',
    }).catch((error) => {
      console.error('Failed to track platform blog post view:', {
        error,
        slug: normalizedSlug,
      });
    });
  }, [slug]);

  return null;
}
