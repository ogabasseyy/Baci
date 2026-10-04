import { PLATFORM_BLOG_PAGE_SIZE } from '@/app/admin/blog/blog-pagination';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogPostDetail,
  PlatformAdminBlogPostSummary,
} from '@/app/admin/blog/blog-types';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  shouldIncludeFeaturedImageFields,
  toApiPayload,
} from './blog-api-payload';

type PlatformBlogListResponse = {
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  posts: PlatformAdminBlogPostSummary[];
  total?: number;
};

export type PlatformBlogListPage = {
  hasMore: boolean;
  limit: number;
  offset: number;
  posts: PlatformAdminBlogPostSummary[];
  total: number;
};

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return payload.error || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export async function listPlatformBlogPosts(): Promise<
  PlatformAdminBlogPostSummary[]
> {
  const page = await listPlatformBlogPostsPage({
    limit: PLATFORM_BLOG_PAGE_SIZE,
    offset: 0,
  });
  return page.posts;
}

export async function listPlatformBlogPostsPage({
  limit = PLATFORM_BLOG_PAGE_SIZE,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
} = {}): Promise<PlatformBlogListPage> {
  const safeLimit = Number.isFinite(limit) ? limit : PLATFORM_BLOG_PAGE_SIZE;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const normalizedLimit = Math.min(Math.max(Math.trunc(safeLimit), 1), 100);
  const normalizedOffset = Math.max(Math.trunc(safeOffset), 0);
  const response = await fetch(
    `/api/admin/blog/posts?limit=${normalizedLimit}&offset=${normalizedOffset}`,
    {
      cache: 'no-store',
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, 'Failed to load platform blog posts')
    );
  }

  const payload = (await response.json()) as PlatformBlogListResponse;
  return {
    hasMore: Boolean(payload.hasMore),
    limit: payload.limit ?? normalizedLimit,
    offset: payload.offset ?? normalizedOffset,
    posts: payload.posts || [],
    total: payload.total ?? payload.posts?.length ?? 0,
  };
}

export async function getPlatformBlogPost(
  id: string
): Promise<PlatformAdminBlogPostDetail> {
  const encodedId = encodeURIComponent(id);
  const response = await fetch(`/api/admin/blog/posts/${encodedId}`, {
    cache: 'no-store',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load post'));
  }

  return response.json();
}

export async function createPlatformBlogPost(
  input: PlatformAdminBlogFormState
): Promise<PlatformAdminBlogPostDetail> {
  const response = await fetchWithCsrf('/api/admin/blog/posts', {
    body: JSON.stringify(toApiPayload(input)),
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create post'));
  }

  return response.json();
}

export async function updatePlatformBlogPost(
  id: string,
  input: PlatformAdminBlogFormState,
  existingPost?: PlatformAdminBlogPostDetail | null
): Promise<PlatformAdminBlogPostDetail> {
  const encodedId = encodeURIComponent(id);
  const includeFeaturedImageFields = shouldIncludeFeaturedImageFields(
    input,
    existingPost
  );
  const response = await fetchWithCsrf(`/api/admin/blog/posts/${encodedId}`, {
    body: JSON.stringify(
      toApiPayload(input, {
        clearEmptyToNull: true,
        existingPost,
        includeFeaturedImageFields,
      })
    ),
    method: 'PATCH',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to update post'));
  }

  return response.json();
}

export async function deletePlatformBlogPost(id: string): Promise<void> {
  const encodedId = encodeURIComponent(id);
  const response = await fetchWithCsrf(`/api/admin/blog/posts/${encodedId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete post'));
  }
}
