export interface BlogAuthorIdentityPostRecord {
  author_title?: string | null;
  author_bio?: string | null;
  author_image_url?: string | null;
}

export interface ResolvedBlogAuthorIdentity {
  name: string;
  title: string | null;
  bio: string | null;
  imageUrl: string | null;
}

function findFirstNonEmptyField(
  posts: readonly BlogAuthorIdentityPostRecord[],
  field: keyof BlogAuthorIdentityPostRecord
): string | null {
  for (const post of posts) {
    const value = post[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function resolveBlogAuthorIdentity(
  authorName: string,
  posts: readonly BlogAuthorIdentityPostRecord[]
): ResolvedBlogAuthorIdentity {
  return {
    name: authorName,
    title: findFirstNonEmptyField(posts, 'author_title'),
    bio: findFirstNonEmptyField(posts, 'author_bio'),
    imageUrl: findFirstNonEmptyField(posts, 'author_image_url'),
  };
}
