import {
  createHash,
  createPrivateKey,
  createSign,
  timingSafeEqual,
} from 'node:crypto';

export interface ExpectSignatureDirective {
  expected: boolean;
  keyid?: string;
  alg?: string;
  error?: string;
}

export function timingSafeBearerMatch(
  authHeader: string | null,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken || expectedToken.length === 0 || !authHeader) {
    return false;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  const provided = match?.[1];
  if (!provided) {
    return false;
  }
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256')
    .update(expectedToken, 'utf8')
    .digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function splitSfvDictionaryMembers(input: string): string[] {
  const members: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      if (current.trim().length > 0) {
        members.push(current.trim());
      }
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    members.push(current.trim());
  }
  return members;
}

function unquoteSfvString(raw: string): string | null {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(raw.trim());
  if (!match?.[1]) {
    return raw.trim() === '""' ? '' : null;
  }
  return match[1].replace(/\\(.)/g, '$1');
}

export function parseExpectSignatureHeader(
  headerValue: string | null
): ExpectSignatureDirective {
  if (!headerValue || headerValue.trim().length === 0) {
    return { expected: false };
  }

  const members = splitSfvDictionaryMembers(headerValue);
  let keyid: string | undefined;
  let alg: string | undefined;

  for (const member of members) {
    const eqIndex = member.indexOf('=');
    const key = (eqIndex === -1 ? member : member.slice(0, eqIndex))
      .trim()
      .toLowerCase();
    const rawValue = eqIndex === -1 ? undefined : member.slice(eqIndex + 1);

    if (key === 'sig') {
      continue;
    }
    if (key === 'alg' && rawValue !== undefined) {
      const parsed = unquoteSfvString(rawValue);
      if (parsed === null || parsed.length === 0) {
        return {
          expected: true,
          error: 'Malformed alg in expo-expect-signature',
        };
      }
      if (parsed !== 'rsa-v1_5-sha256') {
        return {
          expected: true,
          alg: parsed,
          error: `Unsupported signature algorithm: ${parsed}`,
        };
      }
      alg = parsed;
    } else if (key === 'keyid' && rawValue !== undefined) {
      const parsed = unquoteSfvString(rawValue);
      if (parsed === null || parsed.length === 0) {
        return {
          expected: true,
          error: 'Malformed keyid in expo-expect-signature',
        };
      }
      keyid = parsed;
    }
  }

  return {
    expected: true,
    keyid,
    alg: alg ?? 'rsa-v1_5-sha256',
  };
}

function normalizePrivateKeyPem(rawKey: string): string {
  const unescaped = rawKey.trim().replace(/\\n/g, '\n');
  if (unescaped.startsWith('-----BEGIN ')) {
    return unescaped;
  }
  const decoded = Buffer.from(unescaped, 'base64').toString('utf8').trim();
  if (decoded.startsWith('-----BEGIN ')) {
    return decoded;
  }
  return unescaped;
}

export function signRsaSha256Sfv(
  payload: string,
  privateKeyInput: string,
  keyId = 'main'
): string {
  const pem = normalizePrivateKeyPem(privateKeyInput);
  const key = createPrivateKey(pem);
  const signer = createSign('RSA-SHA256');
  signer.update(payload, 'utf8');
  const signatureBase64 = signer.sign(key).toString('base64');
  const safeKeyId = keyId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `sig=:${signatureBase64}:, keyid="${safeKeyId}", alg="rsa-v1_5-sha256"`;
}

export function sha256Base64Url(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function sha256Hex(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}
