/** A token expiry is only a UI hint; provider responses remain authoritative. */
export function selfieLinkExpired(url: string): boolean {
  try {
    const token = new URL(url).searchParams.get('securityToken');
    if (!token) return false;
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return false;
    const data: unknown = JSON.parse(atob(payload));
    return (
      typeof data === 'object' &&
      data !== null &&
      'exp' in data &&
      typeof data.exp === 'number' &&
      data.exp <= Date.now() / 1000
    );
  } catch {
    return false;
  }
}
