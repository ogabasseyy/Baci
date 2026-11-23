/**
 * A record that this browser's chat contact carries a customer link, so a later
 * page load can remove it after a sign-out. It lives in a cookie AND in local
 * storage: storage can be blocked or full, but the customer sign-in itself runs
 * on cookies, so a browser that can sign in can keep this too.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * One cookie name per store, never shared: every character outside letters,
 * digits, `_` and `-` becomes `.<hex>.`, which cannot occur in the plain part,
 * so 'a/b' and 'a_b' can never end up with the same name.
 */
export const linkMarkerCookieName = (storeSlug: string) =>
  `baci_chat_link_${storeSlug.replace(
    /[^A-Za-z0-9_-]/g,
    (char) => `.${char.charCodeAt(0).toString(16)}.`
  )}`;
const storageKey = (storeSlug: string) => `baci-chat-link:${storeSlug}`;

function readCookie(name: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((entry) => entry.trim() === `${name}=1`);
}

function writeCookie(name: string, linked: boolean): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const value = linked
    ? `${name}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  // biome-ignore lint/suspicious/noDocumentCookie: a first-party marker cookie, like the session hint
  document.cookie = value;
}

export function readLinkMarker(storeSlug: string): boolean {
  if (readCookie(linkMarkerCookieName(storeSlug))) return true;
  try {
    return window.localStorage.getItem(storageKey(storeSlug)) === '1';
  } catch {
    return false;
  }
}

export function writeLinkMarker(storeSlug: string, linked: boolean): void {
  writeCookie(linkMarkerCookieName(storeSlug), linked);
  try {
    if (linked) window.localStorage.setItem(storageKey(storeSlug), '1');
    else window.localStorage.removeItem(storageKey(storeSlug));
  } catch {
    // Blocked or full storage: the cookie above still keeps the record.
  }
}
