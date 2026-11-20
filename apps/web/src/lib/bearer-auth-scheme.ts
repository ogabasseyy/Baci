export function hasBearerAuthScheme(request: Request): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  return /^\s*bearer(?:\s|$)/i.test(authHeader);
}
