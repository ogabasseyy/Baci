import { captureCartPairingLink } from '@/lib/cart/pairing-link';

export function capturePairingLink(
  destination: { type: 'web' } | { type: 'native'; app: 'storefront' },
  signature = 'signature'
): string {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const token = `ch1.${Buffer.from(JSON.stringify({ merchantId, destination })).toString('base64url')}.${signature}`;
  const url = `https://shop.example.com/cart#handoff=${token}&hid=22222222-2222-4222-8222-222222222222`;
  captureCartPairingLink(url, {
    merchantId,
    merchantSlug: 'shop',
    merchantDomain: 'shop.example.com',
  });
  return url;
}
