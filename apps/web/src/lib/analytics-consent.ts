// Shared by browser measurement and universal attribution utilities.
export function isAnalyticsAllowed(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const consent = localStorage.getItem('baci-cookie-consent');
    if (!consent) return false;

    const parsed = JSON.parse(consent);
    return parsed.analytics === true;
  } catch {
    return false;
  }
}
