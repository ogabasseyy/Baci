import type { VerifiedRuntimeFile } from '@baci/shared/experience';
import { digestBytes } from './manifest-digest';
/** Compiled output only. Slug/build/path locate public bytes, never grant source authority. */
export async function readPublishedResource(
  slug: string,
  build: string,
  path: string,
  deps: {
    current: (slug: string, build: string) => Promise<boolean>;
    read: (
      slug: string,
      build: string,
      path: string
    ) => Promise<VerifiedRuntimeFile | null>;
  }
): Promise<VerifiedRuntimeFile | null> {
  if (
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ||
    !/^[a-f0-9]{64}$/.test(build) ||
    !/^(app\.(js|css)|assets\/[a-z0-9-]{1,80})$/.test(path)
  )
    return null;
  if (!(await deps.current(slug, build))) return null;
  const file = await deps.read(slug, build, path);
  if (
    !file ||
    file.path !== path ||
    file.bytes.byteLength > 16777216 ||
    digestBytes(file.bytes) !== file.digest ||
    !['text/javascript', 'text/css', 'image/png', 'font/woff2'].includes(
      file.mime
    ) ||
    !(await deps.current(slug, build))
  )
    return null;
  return file;
}
