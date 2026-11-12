/**
 * The response fields that tell the app what an early cancel returns to the
 * main wallet and what interest it forfeits, straight from the server's
 * record (never a client guess). Empty when the server has no split for the
 * attempt (not dispatched yet, or made before the split existed).
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
