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
import {
  getGiftCardPilotConfig,
  PILOT_SUPPLIER_USD,
} from '@/lib/gift-cards/pilot-wallet-config';
import { createClient } from '@/lib/supabase/server';

type PilotWalletState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'quote'; totalKobo: number; expiresAt: number; token: string }
  | { status: 'confirmed'; orderId: string };

const customerMessages = new Set([
  'Sign in to use your wallet.',
  'Gift card pilot is unavailable.',
  'Petrock price or availability could not be verified.',
  'Gift card pricing is temporarily unavailable',
  'Gift card payment could not be confirmed',
  'Price changed. No wallet debit was made.',
  'Please request a fresh price before confirming.',
  'The displayed price expired. Get a fresh quote.',
  'Fresh price expired. Get a fresh quote.',
  'The price expired. Get a fresh quote.',
  'Your wallet balance is too low for this gift card.',
]);

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
    readPetrockOffer: () => readPilotPetrockOffer(PILOT_SUPPLIER_USD),
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
      if (order?.order_status === 'refunded') {
        return {
          status: 'error',
          message: 'Petrock rejected this order. Your wallet was refunded.',
        };
      }
      if (order) return { status: 'confirmed', orderId: order.order_id };
    }
  } catch (error) {
    if (error instanceof Error && customerMessages.has(error.message)) {
      return { status: 'error', message: error.message };
    }
  }
  return {
    status: 'error',
    message:
      'Could not confirm the pilot. Check your balance or request a new price.',
  };
}
