const GUEST_AUTH_PARTITION = 'guest';

function isAuthenticatedPartition(value: string): boolean {
  return value !== '' && value !== GUEST_AUTH_PARTITION;
}

export function queuedCreateOrderOwnerMismatch(
  queuedPartition: string,
  currentUserId: string | undefined
): boolean {
  const owner = queuedPartition || GUEST_AUTH_PARTITION;
  const current = currentUserId ?? GUEST_AUTH_PARTITION;
  return isAuthenticatedPartition(owner) && owner !== current;
}
