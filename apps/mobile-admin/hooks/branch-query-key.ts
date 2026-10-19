export function getBranchesQueryKey(
  merchantId: string | null | undefined,
  includeInactive = false
) {
  return ['branches', merchantId ?? null, includeInactive] as const;
}
