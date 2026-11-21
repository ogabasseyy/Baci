'use server';

import {
  confirmAuthenticatedGiftCardQuote,
  issueAuthenticatedGiftCardQuote,
} from '@/lib/gift-cards/authenticated-wallet';
import { readPilotPetrockOffer } from '@/lib/gift-cards/pilot-petrock-offer';
import {
  confirmGiftCardPilot,
  issueGiftCardPilotQuote,
} from '@/lib/gift-cards/pilot-wallet';
import { getGiftCardPilotConfig } from '@/lib/gift-cards/pilot-wallet-config';
import { createClient } from '@/lib/supabase/server';

type PilotWalletState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'quote'; totalKobo: number; expiresAt: number; token: string }
  | { status: 'confirmed'; orderId: string };

export async function runPilotWalletAction(
  _previous: PilotWalletState,
  form: FormData
): Promise<PilotWalletState> {
  const config = getGiftCardPilotConfig();
  const unavailable = 'The gift card pilot is currently unavailable.';
  if (!config) return { status: 'error', message: unavailable };

  const dependencies = {
    async getUserId() {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getUser();
      return error ? undefined : data.user?.id;
    },
    readPetrockOffer: () => readPilotPetrockOffer(10.28),
    issue: issueAuthenticatedGiftCardQuote,
    confirm: confirmAuthenticatedGiftCardQuote,
  };
  try {
    if (form.get('intent') === 'quote') {
      return {
        status: 'quote',
        ...(await issueGiftCardPilotQuote(config, dependencies)),
      };
    }
    if (form.get('intent') === 'confirm' && form.get('region') === 'US') {
      const order = await confirmGiftCardPilot(
        {
          expiresAt: Number(form.get('expiresAt')),
          token: form.get('token'),
        },
        config,
        dependencies
      );
      if (order) return { status: 'confirmed', orderId: order.order_id };
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Price changed. No wallet debit was made.'
    ) {
      return { status: 'error', message: error.message };
    }
  }
  return {
    status: 'error',
    message:
      'Could not confirm the pilot. Check your balance or request a new price.',
  };
}
