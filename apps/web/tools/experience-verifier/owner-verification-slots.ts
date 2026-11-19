/** Share two long-running slots across owner attestation and public checks. */
export function createOwnerVerificationSlots() {
  const activeOwners = new Set<string>();
  return (ownerId: string) => {
    if (activeOwners.size >= 2 || activeOwners.has(ownerId)) return null;
    activeOwners.add(ownerId);
    return () => {
      activeOwners.delete(ownerId);
    };
  };
}
