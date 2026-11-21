import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  confirmAuthenticatedGiftCardQuote,
  issueAuthenticatedGiftCardQuote,
} from './authenticated-wallet';
import { PILOT_APPROVED_KOBO, PILOT_PRODUCT_ID } from './pilot-wallet-config';

type PilotConfig = { userId: string; orderId: string; presentationKey: string };
interface PilotDependencies {
  getUserId(): Promise<string | undefined>;
  readPetrockOffer(): Promise<boolean>;
  issue: typeof issueAuthenticatedGiftCardQuote;
  confirm: typeof confirmAuthenticatedGiftCardQuote;
}

function signPresentation(config: PilotConfig, expiry: number) {
  return createHmac('sha256', config.presentationKey)
    .update(
      JSON.stringify([
        'gift-card-pilot-presentation-v1',
        config.userId,
        config.orderId,
        expiry,
      ])
    )
    .digest();
}

async function freshPilotQuote(config: PilotConfig, deps: PilotDependencies) {
  const userId = await deps.getUserId();
  if (!userId) throw new Error('Sign in to use your wallet.');
  if (userId !== config.userId) {
    throw new Error('Gift card pilot is unavailable.');
  }
  if (!(await deps.readPetrockOffer())) {
    throw new Error('Petrock price or availability could not be verified.');
  }
  const quote = await deps
    .issue({ cardId: PILOT_PRODUCT_ID }, config.orderId)
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message === 'Sign in to use your wallet.'
      ) {
        throw error;
      }
      throw new Error('Gift card pricing is temporarily unavailable');
    });
  if (quote.totalKobo !== PILOT_APPROVED_KOBO) {
    throw new Error('Price changed. No wallet debit was made.');
  }
  return quote;
}

export async function issueGiftCardPilotQuote(
  config: PilotConfig,
  deps: PilotDependencies
) {
  const quote = await freshPilotQuote(config, deps);
  return {
    expiresAt: quote.expiresAt,
    token: signPresentation(config, quote.expiresAt).toString('hex'),
    totalKobo: quote.totalKobo,
  };
}

export async function confirmGiftCardPilot(
  input: unknown,
  config: PilotConfig,
  deps: PilotDependencies
) {
  const { expiresAt, token } = z
    .object({
      expiresAt: z.number().int(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  if (
    expiresAt <= Date.now() ||
    !timingSafeEqual(
      Buffer.from(token, 'hex'),
      signPresentation(config, expiresAt)
    )
  ) {
    throw new Error('Please request a fresh price before confirming.');
  }
  const fresh = await freshPilotQuote(config, deps);
  const confirmationTime = Date.now();
  if (expiresAt <= confirmationTime)
    throw new Error('The displayed price expired. Get a fresh quote.');
  if (fresh.expiresAt <= confirmationTime)
    throw new Error('Fresh price expired. Get a fresh quote.');
  return deps.confirm(fresh.proof);
}
