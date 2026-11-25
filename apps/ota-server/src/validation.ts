import type { OtaPlatform, StoredManifestAsset } from './types';

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

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
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
  const { hash, key, contentType, fileExtension, r2Key, url } = raw;
  if (typeof hash !== 'string' || hash.trim().length === 0) {
    throw new ValidationError(`${label}.hash is required`);
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

  let validatedR2Key: string | undefined;
  let validatedUrl: string | undefined;

  if (r2Key !== undefined) {
    if (typeof r2Key !== 'string') {
      throw new ValidationError(`${label}.r2Key must be a string`);
    }
    validatedR2Key = validateAssetKey(r2Key);
  }

  if (url !== undefined) {
    if (typeof url !== 'string') {
      throw new ValidationError(`${label}.url must be a string`);
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new ValidationError(`${label}.url must use https`);
      }
      validatedUrl = parsed.toString();
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`${label}.url must be a valid https URL`);
    }
  }

  if (!validatedR2Key && !validatedUrl) {
    throw new ValidationError(`${label} must provide r2Key or url`);
  }

  return {
    hash: hash.trim(),
    key: key.trim(),
    contentType: contentType.trim(),
    ...(fileExtension !== undefined ? { fileExtension } : {}),
    ...(validatedR2Key !== undefined ? { r2Key: validatedR2Key } : {}),
    ...(validatedUrl !== undefined ? { url: validatedUrl } : {}),
  };
}
