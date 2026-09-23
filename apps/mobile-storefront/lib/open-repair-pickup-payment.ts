import * as WebBrowser from 'expo-web-browser';

export async function openRepairPickupPayment(url: string | undefined) {
  if (!url) throw new Error('Payment link unavailable. Please retry.');
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'checkout.paystack.com' ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error('Invalid payment link. Contact support with your ticket.');
  }
  await WebBrowser.openBrowserAsync(url);
}
