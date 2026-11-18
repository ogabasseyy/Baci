// Parse only public client metadata. Signing secrets never enter this module.
function decodeJson(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1)
    throw new Error('Invalid public client metadata');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let buffer = 0;
  let bits = 0;
  let bytes = '';
  for (const character of segment.replace(/-/g, '+').replace(/_/g, '/')) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes += `%${((buffer >> bits) & 255).toString(16).padStart(2, '0')}`;
    }
  }
  return JSON.parse(decodeURIComponent(bytes));
}
function validOxygenStagingPublicKey(
  key,
  expectedIssuer,
  localGateway = false
) {
  if (typeof key !== 'string' || key.length > 8192) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(key)) return true;
  try {
    const segments = key.split('.');
    if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[2]))
      return false;
    const header = decodeJson(segments[0]);
    const claims = decodeJson(segments[1]);
    return (
      header.alg === 'HS256' &&
      header.typ === 'JWT' &&
      claims.role === 'anon' &&
      claims.iss === (localGateway ? 'supabase' : expectedIssuer) &&
      !('ref' in claims) &&
      !('project_ref' in claims) &&
      typeof claims.exp === 'number' &&
      Number.isFinite(claims.exp) &&
      claims.exp > Date.now() / 1000 &&
      (!('nbf' in claims) ||
        (typeof claims.nbf === 'number' && claims.nbf <= Date.now() / 1000))
    );
  } catch {
    return false;
  }
}
module.exports = { validOxygenStagingPublicKey };
