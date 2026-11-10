import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experiencePublicOutputFile,
  experiencePublicPrerenderBinding,
} from '@/schemas/experience-public-output';
import { parsePublishedExperience } from './published-manifest';
import { readPublishedResource } from './published-resource';

export function createPublicOutputReader(client: SupabaseClient) {
  const manifest = async (slug: string) => {
    const r = await client.rpc('experience_public_manifest', { p_slug: slug });
    if (r.error || !r.data) return null;
    return parsePublishedExperience(r.data);
  };
  const current = async (slug: string, build: string) =>
    (await manifest(slug))?.buildDigest === build;
  const read = async (slug: string, build: string, path: string) => {
    const r = await client.rpc('experience_public_file', {
      p_slug: slug,
      p_build: build,
      p_path: path,
    });
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
    async prerenderBinding(slug: string, build: string) {
      const head = await manifest(slug);
      if (head?.buildDigest !== build) return null;
      const result = await client.rpc('experience_public_prerender_binding', {
        p_slug: slug,
        p_build: build,
      });
      const parsed = experiencePublicPrerenderBinding.safeParse(result.data);
      if (
        result.error ||
        !parsed.success ||
        parsed.data.merchantId !== head.merchantId ||
        parsed.data.buildDigest !== build ||
        JSON.stringify(await manifest(slug)) !== JSON.stringify(head)
      )
        return null;
      return parsed.data;
    },
    read: (slug: string, build: string, path: string) =>
      readPublishedResource(slug, build, path, { current, read }),
  };
}
