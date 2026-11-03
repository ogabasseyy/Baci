/** A token expiry is only a UI hint; provider responses remain authoritative. */
export function selfieLinkExpiration(url: string): number | null {
  try {
    const token = new URL(url).searchParams.get('securityToken');
    if (!token) return null;
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return null;
    const data: unknown = JSON.parse(atob(payload));
    if (
      typeof data === 'object' &&
      data !== null &&
      'exp' in data &&
      typeof data.exp === 'number' &&
      Number.isFinite(data.exp)
    )
      return data.exp * 1000;
    return null;
  } catch {
    return null;
  }
}

export function selfieLinkExpired(url: string): boolean {
  const expiration = selfieLinkExpiration(url);
  return expiration !== null && expiration <= Date.now();
}
