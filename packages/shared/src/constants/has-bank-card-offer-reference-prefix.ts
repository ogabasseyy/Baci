// Reserve the namespace for routing, then validate the exact reference.
export function hasBankCardOfferReferencePrefix(
  reference: string | null | undefined
): boolean {
  return /^BCO-/i.test(reference ?? '');
}
