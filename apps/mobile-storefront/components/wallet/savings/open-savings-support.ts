import { Linking } from 'react-native';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { SUPPORT_PHONE, SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';

const MESSAGE = 'Hi, I need help finishing my savings plan setup.';

/**
 * A short plan reference (the start of the goal id) so support can find the
 * plan without asking. It names no person and no money.
 */
export function savingsSupportMessage(goalId?: string): string {
  const reference = goalId?.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return reference ? `${MESSAGE} Plan reference: ${reference}.` : MESSAGE;
}

/**
 * Opens a WhatsApp chat with support, prefilled with what the customer needs.
 * If WhatsApp cannot open, says how else to reach support instead of failing
 * silently.
 */
export function openSavingsSupport(goalId?: string): Promise<unknown> {
  return Linking.openURL(
    `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(savingsSupportMessage(goalId))}`
  ).catch(() => {
    showAppAlert({
      title: 'Couldn’t open WhatsApp',
      message: `Call or text us on ${SUPPORT_PHONE} and we’ll help you finish your plan.`,
      variant: 'info',
    });
  });
}
