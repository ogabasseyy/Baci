/** Merchant-wide grants require owner authority; so does this UI. */
export function canManageConnectorConnection(staffAccess: {
  isOwner: boolean;
}): boolean {
  return staffAccess.isOwner === true;
}
