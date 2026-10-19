import { interestPayoutSuccessEventSchema } from '../../src/schemas/piggyvest/events';
import { PIGGYVEST_INTEREST_REPLAY_STATEMENT } from './replay-interest-statement';
import { DispatchQuarantine } from './replay-worker';
import { replayFinancialSchemas } from './schemas/replay-financial';

export function createInterestReplay(
  scope: unknown,
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>
) {
  const config = replayFinancialSchemas.scope.parse(scope);
  return async (input: unknown): Promise<'applied' | 'duplicate'> => {
    const parsed = interestPayoutSuccessEventSchema.safeParse(input);
    if (!parsed.success) throw new DispatchQuarantine({ reason: 'poison' });
    const event = parsed.data;
    const data = event.eventData;
    const breakdown = data.break_down;
    if (
      (event.pvb_destination_wallet !== null &&
        event.pvb_destination_wallet !== data.destination_wallet) ||
      breakdown.gross_interest_payout - breakdown.withholding_tax !==
        breakdown.net_interest_payout ||
      data.amount !== breakdown.net_interest_payout
    ) {
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: 'conflict',
      });
    }
    let result: unknown;
    try {
      result = (
        await execute(PIGGYVEST_INTEREST_REPLAY_STATEMENT.text, [
          config.integrationId,
          config.businessId,
          config.expectedSystemId,
          JSON.stringify({
            payoutId: data.id,
            providerCustomerId: event.customer_id,
            sourceWalletId: event.pvb_accrued_interest_wallet,
            destinationWalletId: data.destination_wallet,
            reference: data.reference,
            amountKobo: data.amount,
            grossKobo: breakdown.gross_interest_payout,
            taxKobo: breakdown.withholding_tax,
            netKobo: breakdown.net_interest_payout,
            currency: 'NGN',
          }),
          event.eventId,
        ])
      ).rows;
    } catch {
      throw new Error('Interest replay deferred');
    }
    const acknowledgement = replayFinancialSchemas.outcome.safeParse(result);
    if (!acknowledgement.success) throw new Error('Interest replay deferred');
    const outcome = acknowledgement.data[0].result;
    if (outcome === 'invalid' || outcome === 'conflict') {
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: outcome === 'invalid' ? 'poison' : 'conflict',
      });
    }
    if (outcome === 'deferred') throw new Error('Interest replay deferred');
    return outcome;
  };
}
