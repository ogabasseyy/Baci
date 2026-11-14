import 'server-only';
import { after } from 'next/server';

/**
 * Runs a goal cancel's interest-forfeit leg after the response is sent, so
 * its provider calls (each with its own timeout) never hold up or time out the
 * customer's confirmed answer. The daily forfeit sweep is the backstop if the
 * task does not finish.
 */
export function deferGoalCancelForfeit(task: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        // The leg reports most failures as an outcome rather than throwing.
        if ((await task()) === 'failed')
          console.warn(
            '[PiggyVest] Goal cancel interest leg failed after the answer; the daily sweep retries:',
            'failed'
          );
      } catch (error) {
        // Swept later; never surfaces to the customer.
        console.warn(
          '[PiggyVest] Goal cancel interest leg failed after the answer; the daily sweep retries:',
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    });
  } catch (error) {
    // Could not be scheduled (no request scope): the customer's confirmed
    // answer stands and the daily sweep sends the interest.
    console.warn(
      '[PiggyVest] Goal cancel interest leg not scheduled; the daily sweep sends it:',
      error instanceof Error ? error.message : 'unknown error'
    );
  }
}
