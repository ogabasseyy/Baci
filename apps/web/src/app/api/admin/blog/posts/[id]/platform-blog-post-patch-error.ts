type PlatformPatchRpcError = {
  code?: string;
  message?: string;
} | null;

export function readPlatformPatchError(error: PlatformPatchRpcError): {
  error: string;
  status: 404 | 409 | 500;
} {
  if (error?.code === 'P0002') {
    return { error: 'Post not found', status: 404 };
  }
  if (error?.code === '23505') {
    return { error: 'A post with this slug already exists', status: 409 };
  }
  if (
    error?.code === 'P0001' &&
    error.message?.includes('platform_blog_media_swept_during_save')
  ) {
    return { error: 'Referenced media was removed during save', status: 500 };
  }
  return { error: 'Failed to update platform blog post', status: 500 };
}
