export type OwnerVerificationKind = 'attest' | 'public' | 'build';

/** Bound expensive owner work independently of the verifier's listener slots. */
export function createOwnerVerificationSlots() {
  const activeOwners = new Map<string, OwnerVerificationKind>();
  return (ownerId: string, kind: OwnerVerificationKind) => {
    if (
      activeOwners.size >= 2 ||
      activeOwners.has(ownerId) ||
      (kind !== 'attest' && [...activeOwners.values()].includes(kind))
    )
      return null;
    activeOwners.set(ownerId, kind);
    return () => {
      activeOwners.delete(ownerId);
    };
  };
}
