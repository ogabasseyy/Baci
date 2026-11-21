// Include malformed Bearer credentials so protected callers cannot fall back
// to a cookie session when a Bearer credential was attempted.
export function hasBearerAuthScheme(request: Request): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  return /^\s*bearer(?:\s|$)/i.test(authHeader);
}
