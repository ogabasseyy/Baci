export function hasValidFixtureCsrf(request: Request): boolean {
  const token = request.headers.get('x-csrf-token');
  if (!token) return false;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find(
      (part) =>
        part.startsWith('csrf-token=') || part.startsWith('__Host-csrf-token=')
    );
  return cookie?.slice(cookie.indexOf('=') + 1) === token;
}
