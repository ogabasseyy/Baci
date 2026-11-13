import 'server-only';
import { after } from 'next/server';

/**
 * Runs a goal cancel's interest-forfeit leg after the response is sent, so
 * its provider calls (each with its own timeout) never hold up or time out the
 * customer's confirmed answer. The daily forfeit sweep is the backstop if the
 * task does not finish.
 */
export function deferGoalCancelForfeit(task: () => Promise<unknown>): void {
  after(async () => {
    try {
      await task();
    } catch {
      // Swept later; never surfaces to the customer.
    }
  });
}
