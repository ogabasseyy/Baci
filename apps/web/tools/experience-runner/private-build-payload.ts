import { gunzipSync, gzipSync } from 'node:zlib';
import type { ExperienceManifest } from '@baci/shared/experience';
import { productionOrigin } from '../../src/lib/experience/production-origins';
import { localPreviewHost } from './preview-origin';

type PrivateInput = {
  mode: 'private-build';
  manifest: ExperienceManifest;
  hostOrigin: string;
  profile?: 'production';
  previewOrigin?: string;
};
type CompressedInput = {
  mode: 'private-build-gzip';
  manifestGzip: string;
  hostOrigin: string;
  profile?: 'production';
  previewOrigin?: string;
};
/** JSON escaping must not silently reduce the4MiB raw-source quota. */
export function packPrivateBuild(
  manifest: ExperienceManifest,
  origin: string,
  profile?: 'production',
  previewOrigin?: string
): PrivateInput | CompressedInput {
  if (previewOrigin && profile !== 'production')
    throw Error('Invalid build profile');
  if (previewOrigin) productionOrigin(previewOrigin);
  const hostOrigin =
    profile === 'production'
      ? productionOrigin(origin)
      : localPreviewHost(origin);
  const raw: PrivateInput = {
    mode: 'private-build',
    manifest,
    hostOrigin,
    ...(profile ? { profile } : {}),
    ...(previewOrigin ? { previewOrigin } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(raw)) <= 8388608) return raw;
  const wire: CompressedInput = {
    mode: 'private-build-gzip',
    ...(profile ? { profile } : {}),
    ...(previewOrigin ? { previewOrigin } : {}),
    manifestGzip: gzipSync(JSON.stringify(manifest)).toString('base64'),
    hostOrigin,
  };
  if (Buffer.byteLength(JSON.stringify(wire)) > 8388608)
    throw Error('Input budget');
  return wire;
}
export function unpackPrivateBuild(input: unknown): PrivateInput | null {
  if (!input || typeof input !== 'object' || !('mode' in input)) return null;
  if ('profile' in input && input.profile !== 'production')
    throw Error('Invalid build profile');
  const profile = 'profile' in input ? ('production' as const) : undefined;
  const validateOrigin = profile ? productionOrigin : localPreviewHost;
  const previewOrigin =
    'previewOrigin' in input ? input.previewOrigin : undefined;
  if (
    previewOrigin !== undefined &&
    (profile !== 'production' || typeof previewOrigin !== 'string')
  )
    throw Error('Invalid preview origin');
  if (typeof previewOrigin === 'string') productionOrigin(previewOrigin);
  if (input.mode === 'private-build') {
    if (
      !('manifest' in input) ||
      !('hostOrigin' in input) ||
      typeof input.hostOrigin !== 'string'
    )
      throw Error('Invalid build input');
    return {
      mode: 'private-build',
      manifest: input.manifest as ExperienceManifest,
      hostOrigin: validateOrigin(input.hostOrigin),
      ...(profile ? { profile } : {}),
      ...(previewOrigin ? { previewOrigin } : {}),
    };
  }
  if (input.mode !== 'private-build-gzip') return null;
  if (
    !('manifestGzip' in input) ||
    typeof input.manifestGzip !== 'string' ||
    input.manifestGzip.length > 8388608 ||
    !('hostOrigin' in input) ||
    typeof input.hostOrigin !== 'string'
  )
    throw Error('Invalid build input');
  const compressed = Buffer.from(input.manifestGzip, 'base64');
  if (compressed.toString('base64') !== input.manifestGzip)
    throw Error('Invalid build input');
  const manifest: unknown = JSON.parse(
    gunzipSync(compressed, { maxOutputLength: 33554432 }).toString('utf8')
  );
  return {
    mode: 'private-build',
    manifest: manifest as ExperienceManifest,
    hostOrigin: validateOrigin(input.hostOrigin),
    ...(profile ? { profile } : {}),
    ...(previewOrigin ? { previewOrigin } : {}),
  };
}
