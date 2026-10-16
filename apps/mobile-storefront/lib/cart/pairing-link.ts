import { nativePairingHintSchema } from '@/schemas/cart-pairing';

interface Config {
  merchantId: string;
  merchantSlug: string;
  merchantDomain: string;
  /**
   * Platform storefront root the slug subdomain lives under. Mirrors
   * the web `NEXT_PUBLIC_ROOT_DOMAIN` configuration; defaults to the
   * same production root when a build does not configure one.
   */
  platformRootDomain?: string;
}
export interface CartPairingLink {
  merchantId: string;
  token: string;
  handoffId: string;
  destination: 'web' | 'native';
  browserUrl: string;
}
let pending: CartPairingLink | null = null;
let revision = 0;
const listeners = new Set<() => void>();
function update(value: CartPairingLink | null): void {
  pending = value;
  revision += 1;
  for (const listener of listeners) listener();
}
export function clearCartPairingLink(): void {
  update(null);
}
export function clearMatchingCartPairingLink(handoffId: string): void {
  if (pending?.handoffId === handoffId) update(null);
}
export function peekCartPairingLink(): CartPairingLink | null {
  return pending;
}
export function cartPairingRevision(): number {
  return revision;
}
export function subscribeCartPairing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Secrets stay in this ephemeral closure, never in route params, logs or display persistence. */
export function captureCartPairingLink(path: string, config: Config): string {
  let url: URL;
  try {
    url = new URL(path, 'https://invalid.local');
  } catch {
    return /handoff|hid=/i.test(path) ? '/cart' : path;
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const pairing =
    fragment.has('handoff') ||
    fragment.has('hid') ||
    url.searchParams.has('handoff') ||
    url.searchParams.has('hid');
  if (!pairing) return path;
  update(null);
  try {
    // An explicitly empty root is the fail-closed signal from hosts
    // whose root cannot be derived: never substitute the production
    // root, or staging handoff links would silently fail (or worse,
    // be validated against the wrong tenant root).
    const configuredRoot = config.platformRootDomain?.trim().toLowerCase();
    const platformRoot =
      configuredRoot === undefined ? 'usebaci.com' : configuredRoot;
    const allowed = new Set([config.merchantDomain.toLowerCase()]);
    if (platformRoot) {
      allowed.add(`${config.merchantSlug}.${platformRoot}`.toLowerCase());
    }
    if (
      !config.merchantId ||
      !config.merchantSlug ||
      !path.startsWith('https://') ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !allowed.has(url.hostname.toLowerCase()) ||
      url.pathname !== '/cart' ||
      url.search ||
      path.length > 10000
    )
      return '/cart';
    if (
      [...fragment.keys()].length !== 2 ||
      fragment.getAll('handoff').length !== 1 ||
      fragment.getAll('hid').length !== 1
    )
      return '/cart';
    const token = fragment.get('handoff') ?? '';
    const handoffId = fragment.get('hid') ?? '';
    if (
      !/^ch1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(handoffId)
    )
      return '/cart';
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const hint = nativePairingHintSchema.parse(
      JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    );
    if (hint.merchantId.toLowerCase() !== config.merchantId.toLowerCase())
      return '/cart';
    // This hint selects a UI path only. Preview + server signature/grant checks remain mandatory.
    update({
      token,
      handoffId,
      merchantId: config.merchantId,
      destination: hint.destination.type,
      browserUrl: url.toString(),
    });
  } catch {
    /* Invalid links are stripped without logging their secret. */
  }
  return '/cart';
}
