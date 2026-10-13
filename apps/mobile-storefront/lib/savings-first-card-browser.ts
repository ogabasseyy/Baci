import * as WebBrowser from 'expo-web-browser';
import { SavingsFirstCardCheckoutSchemas as schemas } from '@/schemas/savings-first-card-checkout';

export async function openSavingsFirstCardBrowser(url: string) {
  const authorizationUrl = schemas.authorizationUrl.parse(url);
  return await WebBrowser.openBrowserAsync(authorizationUrl, {
    showInRecents: true,
  });
}
