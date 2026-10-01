import { clampImageDecodeDimension } from './image-decode-dimensions';
import { resolveSafeImageUri } from './safe-image-uri';

/**
 * Normalize an Expo Image source without changing non-URI sources. The
 * generic return type keeps caller-specific Expo source metadata (headers,
 * cache keys, and so on) intact while allowing catalog URIs to use the safe
 * CDN fallback.
 */
export function resolveSafeImageSource<T>(
  source: T,
  { fit }: { fit?: 'inside' | 'cover' } = {}
): T {
  if (Array.isArray(source)) {
    return source.map((entry) => resolveSafeImageSource(entry, { fit })) as T;
  }

  if (typeof source === 'string') {
    return resolveSafeImageUri(source, { fit }) as T;
  }

  if (!source || typeof source !== 'object') {
    return source;
  }

  const sourceRecord = source as Record<string, unknown>;
  if (typeof sourceRecord.uri !== 'string') {
    return source;
  }

  return {
    ...sourceRecord,
    ...(typeof sourceRecord.height === 'number'
      ? { height: clampImageDecodeDimension(sourceRecord.height) }
      : {}),
    uri: resolveSafeImageUri(sourceRecord.uri, {
      height:
        typeof sourceRecord.height === 'number'
          ? clampImageDecodeDimension(sourceRecord.height)
          : undefined,
      width:
        typeof sourceRecord.width === 'number'
          ? clampImageDecodeDimension(sourceRecord.width)
          : undefined,
      ...(fit ? { fit } : {}),
    }),
    ...(typeof sourceRecord.width === 'number'
      ? { width: clampImageDecodeDimension(sourceRecord.width) }
      : {}),
  } as T;
}
