import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experiencePublicOutputFile,
  experiencePublicPrerenderBinding,
} from '@/schemas/experience-public-output';
import { parsePublishedExperience } from './published-manifest';
import { readPublishedResource } from './published-resource';

export function createPublicOutputReader(client: SupabaseClient) {
  const manifest = async (slug: string, signal?: AbortSignal) => {
    const query = client.rpc('experience_public_manifest', { p_slug: slug });
    const r = await (signal ? query.abortSignal(signal) : query);
    if (r.error || !r.data) return null;
    return parsePublishedExperience(r.data);
  };
  const read = async (
    slug: string,
    build: string,
    path: string,
    signal?: AbortSignal
  ) => {
    const query = client.rpc('experience_public_file', {
      p_slug: slug,
      p_build: build,
      p_path: path,
    });
    const r = await (signal ? query.abortSignal(signal) : query);
    const value = experiencePublicOutputFile.safeParse(r.data);
    return r.error || !value.success
      ? null
      : {
          path: value.data.path,
          digest: value.data.digest,
          mime: value.data.mime,
          bytes: Buffer.from(value.data.hex, 'hex'),
        };
  };
  return {
    manifest,
    async prerenderBinding(slug: string, build: string, signal?: AbortSignal) {
      const head = await manifest(slug, signal);
      if (head?.buildDigest !== build) return null;
      const query = client.rpc('experience_public_prerender_binding', {
        p_slug: slug,
        p_build: build,
      });
      const result = await (signal ? query.abortSignal(signal) : query);
      const parsed = experiencePublicPrerenderBinding.safeParse(result.data);
      if (
        result.error ||
        !parsed.success ||
        parsed.data.merchantId !== head.merchantId ||
        parsed.data.buildDigest !== build ||
        JSON.stringify(await manifest(slug, signal)) !== JSON.stringify(head)
      )
        return null;
      return parsed.data;
    },
    read: (slug: string, build: string, path: string, signal?: AbortSignal) =>
      readPublishedResource(slug, build, path, {
        current: async (slug, build) =>
          (await manifest(slug, signal))?.buildDigest === build,
        read: (slug, build, path) => read(slug, build, path, signal),
      }),
  };
}
