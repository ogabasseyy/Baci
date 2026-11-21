// Keep bare Bearer recognizable so callers can enforce any additional
// admission or reject cookie fallback when the route requires explicit proof.
export function hasBearerAuthScheme(request: Request): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  return /^\s*bearer(?:\s|$)/i.test(authHeader);
}
