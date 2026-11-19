import * as WebBrowser from 'expo-web-browser';

/** Open only the original Paystack-hosted checkout, never a new payment. */
export async function openWalletPaystackCheckout(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'checkout.paystack.com' ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error('Invalid Paystack checkout link');
  }
  await WebBrowser.openBrowserAsync(url);
}
