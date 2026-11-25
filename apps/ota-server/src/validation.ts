import type { OtaPlatform, StoredManifestAsset } from './types';

export const MAX_ASSET_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_PUBLISH_JSON_BYTES = 512 * 1024;
export const MAX_ROLLBACK_JSON_BYTES = 16 * 1024;
export const MAX_MANIFEST_ASSETS = 500;
export const MAX_EXTRA_BYTES = 256 * 1024;
export const MAX_METADATA_BYTES = 16 * 1024;

export async function readBodyBytesWithLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array> {
  const rawContentLength = request.headers.get('content-length');
  if (rawContentLength !== null) {
    const declared = Number(rawContentLength.trim());
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new ValidationError(
        `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
        413
      );
    }
  }

  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ValidationError(
        `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
        413
      );
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class ValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

const CHANNEL_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;
const RUNTIME_REGEX = /^[a-zA-Z0-9._+-]{1,128}$/;
const SEGMENT_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;
const SHA256_BASE64URL_REGEX = /^[A-Za-z0-9_-]{43}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  message: string,
  status = 400,
  code?: string
): Response {
  return jsonResponse(
    code ? { error: message, code } : { error: message },
    status
  );
}

export function validatePlatform(raw: string | null | undefined): OtaPlatform {
  if (raw === 'ios' || raw === 'android') {
    return raw;
  }
  throw new ValidationError(
    'Invalid or missing platform (expected ios or android)'
  );
}

export function validateChannelName(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 'production';
  }
  if (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    !CHANNEL_REGEX.test(trimmed)
  ) {
    throw new ValidationError('Invalid expo-channel-name');
  }
  return trimmed;
}

export function validateRuntimeVersion(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    !RUNTIME_REGEX.test(trimmed)
  ) {
    throw new ValidationError('Invalid or missing expo-runtime-version');
  }
  return trimmed;
}

export function validateUpdateId(raw: string): string {
  const trimmed = raw.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new ValidationError('Invalid updateId (expected UUID)');
  }
  return trimmed.toLowerCase();
}

export function validateCommitSha(raw: string): string {
  const trimmed = raw.trim();
  if (!COMMIT_SHA_REGEX.test(trimmed)) {
    throw new ValidationError('Invalid sourceSha (expected 40-char hex SHA)');
  }
  return trimmed.toLowerCase();
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertCleanPathSegments(pathValue: string): string[] {
  if (
    !pathValue ||
    pathValue.startsWith('/') ||
    pathValue.endsWith('/') ||
    pathValue.includes('\\') ||
    hasControlCharacter(pathValue)
  ) {
    throw new ValidationError('Invalid asset path');
  }
  const segments = pathValue.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !SEGMENT_REGEX.test(segment)) {
      throw new ValidationError('Invalid asset path segment');
    }
  }
  return segments;
}

export function validateAssetKey(rawPath: string): string {
  if (!rawPath || rawPath.length > 512) {
    throw new ValidationError('Invalid asset path');
  }
  if (/%(?:2e|2f|5c|00)/i.test(rawPath) || rawPath.includes('%')) {
    throw new ValidationError(
      'Percent-encoded characters are not allowed in asset paths'
    );
  }
  const rawSegments = assertCleanPathSegments(rawPath);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new ValidationError('Malformed asset path');
  }
  const decodedSegments = assertCleanPathSegments(decoded);
  if (decodedSegments.join('/') !== rawSegments.join('/')) {
    throw new ValidationError('Invalid asset path');
  }
  return decodedSegments.join('/');
}

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateStoredAsset(
  raw: unknown,
  label: string
): StoredManifestAsset {
  if (!isPlainObject(raw)) {
    throw new ValidationError(`${label} must be an object`);
  }
  const { hash, key, contentType, fileExtension, r2Key } = raw;
  if (typeof hash !== 'string' || !SHA256_BASE64URL_REGEX.test(hash.trim())) {
    throw new ValidationError(
      `${label}.hash must be an unpadded base64url SHA-256 digest`
    );
  }
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new ValidationError(`${label}.key is required`);
  }
  if (typeof contentType !== 'string' || contentType.trim().length === 0) {
    throw new ValidationError(`${label}.contentType is required`);
  }
  if (
    fileExtension !== undefined &&
    (typeof fileExtension !== 'string' ||
      !/^\.[a-zA-Z0-9]+$/.test(fileExtension))
  ) {
    throw new ValidationError(`${label}.fileExtension must start with "."`);
  }

  if (typeof r2Key !== 'string' || r2Key.trim().length === 0) {
    throw new ValidationError(`${label}.r2Key is required`);
  }
  const validatedR2Key = validateAssetKey(r2Key);

  return {
    hash: hash.trim(),
    key: key.trim(),
    contentType: contentType.trim(),
    ...(fileExtension !== undefined ? { fileExtension } : {}),
    r2Key: validatedR2Key,
  };
}

const ALLOWED_ASSET_CONTENT_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/octet-stream',
  'application/pdf',
  'application/wasm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/css',
  'text/javascript',
  'text/plain',
  'video/mp4',
]);

export function validateAssetContentType(
  rawHeader: string | null | undefined
): string {
  const raw = rawHeader?.trim() || 'application/octet-stream';
  const mimeType = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_ASSET_CONTENT_TYPES.has(mimeType)) {
    throw new ValidationError(
      `Unsupported asset content-type: ${mimeType || 'empty'}`,
      415
    );
  }
  return raw;
}
