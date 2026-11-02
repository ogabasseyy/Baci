import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseMock,
  makeDeleteRequest,
  mockAuthenticatedRequest,
  mockAuthorizedMerchant,
  mockCheckCsrfProtection,
  mockCheckRateLimit,
  mockIsManagedBlogStoragePath,
  ownerAccess,
} from './route.test-support';

const { DELETE } = await import('./delete');

describe('delete blog image handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizedMerchant();
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
    mockCheckRateLimit.mockResolvedValue(true);
    mockIsManagedBlogStoragePath.mockReturnValue(true);
  });

  it('does not delete a managed image when storage reports a failure', async () => {
    const { remove, supabase } = createSupabaseMock();
    remove.mockResolvedValue({ error: { message: 'storage unavailable' } });
    mockAuthenticatedRequest(supabase);

    const response = await DELETE(
      makeDeleteRequest({ path: `${ownerAccess.merchantId}/blog/cover.png` })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'media_delete_pending',
      error: 'Deletion is pending. Retry to finish removing this file.',
    });
  });

  it('requires a managed path for every requested image variant', async () => {
    const { supabase } = createSupabaseMock();
    mockAuthenticatedRequest(supabase);
    mockIsManagedBlogStoragePath.mockImplementation((path: string) =>
      path.endsWith('cover.png')
    );

    const response = await DELETE(
      makeDeleteRequest({
        path: `${ownerAccess.merchantId}/blog/cover.png`,
        variantPaths: [`${ownerAccess.merchantId}/blog/cover.webp`],
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });
});
