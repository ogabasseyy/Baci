import { vi } from 'vitest';
import type { useMerchant } from '@/hooks/use-merchant-client';

export function createJsonResponse(body: unknown): Response {
  const textBody = JSON.stringify(body);

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => textBody,
    clone() {
      return createJsonResponse(body);
    },
  } as Response;
}

export type MockMerchantReturn = ReturnType<typeof useMerchant>;

export function createMerchantMock({
  basePath,
  slug,
  templateId,
}: {
  basePath: string;
  slug: string;
  templateId: string;
}): MockMerchantReturn {
  return {
    merchant: {
      id: `${slug}-merchant-id`,
      user_id: `${slug}-owner-id`,
      business_name: `${slug} Store`,
      business_type: 'electronics',
      slug,
      template_id: templateId,
    },
    loading: false,
    updateMerchant: vi.fn(),
    reloadMerchant: vi.fn(),
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: {},
    },
    hasPermission: vi.fn(() => true),
    routingMode: 'path',
    basePath,
    navigationCategories: [],
  };
}
