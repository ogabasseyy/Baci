/**
 * The response fields that tell the app what an early cancel returns to the
 * main wallet and what interest is not refunded to the customer, straight
 * from the server's record (never a client guess). Contract: the answer's
 * status says whether they are final. On 'pending' (202) they are the plan the
 * principal transfer in flight carries, to be shown as expected, never as
 * money already back; on 'confirmed' (200) they are final for the customer.
 * The interest figure is set at dispatch and follows interest PiggyVest pays
 * or reverses after it; Ogabassey's own interest-wallet transfer settles
 * separately and never changes either figure. Empty when the server has no
 * split for the attempt (not dispatched yet, or made before the split
 * existed), and never sent while the attempt is under review.
 */
export function goalCancelAmountFields(result: {
  amounts?: { principalKobo: number; forfeitedInterestKobo: number };
}): { principalKobo?: number; forfeitedInterestKobo?: number } {
  if (!result.amounts) return {};
  return {
    principalKobo: result.amounts.principalKobo,
    forfeitedInterestKobo: result.amounts.forfeitedInterestKobo,
  };
}
