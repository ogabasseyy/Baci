import type { AdminPlatformAccessMembership } from '@/schemas/admin-platform-access';

export interface AccessListResponse {
  data: AdminPlatformAccessMembership[];
  generatedAt: string;
  limit: number;
  offset: number;
  truncated: boolean;
}

export const ACCESS_ROSTER_PAGE_SIZE = 100;

export async function loadAccessMembers(
  offset = 0,
  limit = ACCESS_ROSTER_PAGE_SIZE
): Promise<AccessListResponse> {
  const response = await fetch(
    `/api/admin/access?limit=${limit}&offset=${offset}`
  );
  if (!response.ok) throw new Error('platform_access_load_failed');
  return (await response.json()) as AccessListResponse;
}
