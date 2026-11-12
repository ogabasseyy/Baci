import { Linking } from 'react-native';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';

const MESSAGE = 'Hi, I need help finishing my savings plan setup.';

/** Opens a WhatsApp chat with support, prefilled with what the customer needs. */
export function openSavingsSupport(): Promise<unknown> {
  return Linking.openURL(
    `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(MESSAGE)}`
  ).catch(() => undefined);
}
