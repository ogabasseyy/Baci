import {
  type CompiledCandidate,
  verifyCompiledCandidate,
} from '../../src/lib/experience/compiled-candidate';
export interface PrerenderBinding {
  merchantId: string;
  buildId: string;
  buildDigest: string;
  sourceDigest: string;
}
/** Local-only companion output. No HTML, credentials or owner client is retained. */
export function createLocalPrerenderArtifacts() {
  const retained = new Map<
    string,
    PrerenderBinding & { renderer: CompiledCandidate; bytes: number }
  >();
  const key = (v: PrerenderBinding) =>
    JSON.stringify([v.merchantId, v.buildId]);
  let retainedBytes = 0;
  return {
    retain(input: PrerenderBinding & { renderer: unknown }) {
      const renderer = verifyCompiledCandidate(input.renderer);
      const previous = retained.get(key(input));
      if (previous) {
        if (
          previous.buildDigest !== input.buildDigest ||
          previous.sourceDigest !== input.sourceDigest ||
          previous.renderer.digest !== renderer.digest
        )
          throw Error('BUILD_FAILED');
        return;
      }
      const bytes = Buffer.byteLength(JSON.stringify(renderer));
      if (bytes > 67108864) throw Error('QUOTA_EXCEEDED');
      while (retained.size >= 32 || retainedBytes + bytes > 67108864) {
        const oldest = retained.entries().next().value;
        if (!oldest) throw Error('QUOTA_EXCEEDED');
        retained.delete(oldest[0]);
        retainedBytes -= oldest[1].bytes;
      }
      retainedBytes += bytes;
      retained.set(key(input), {
        merchantId: input.merchantId,
        buildId: input.buildId,
        buildDigest: input.buildDigest,
        sourceDigest: input.sourceDigest,
        renderer: structuredClone(renderer),
        bytes,
      });
    },
    read(binding: PrerenderBinding) {
      const value = retained.get(key(binding));
      if (
        !value ||
        value.merchantId !== binding.merchantId ||
        value.buildId !== binding.buildId ||
        value.buildDigest !== binding.buildDigest ||
        value.sourceDigest !== binding.sourceDigest
      )
        throw Error('OUTPUT_NOT_RETAINED');
      retained.delete(key(binding));
      retained.set(key(binding), value);
      return structuredClone(value.renderer);
    },
  };
}
export type LocalPrerenderArtifacts = ReturnType<
  typeof createLocalPrerenderArtifacts
>;
export function unpackPrerenderBuild(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('client' in value) ||
    !('renderer' in value)
  )
    throw Error('BUILD_FAILED');
  const client = verifyCompiledCandidate(value.client);
  const renderer = verifyCompiledCandidate(value.renderer);
  if (renderer.css !== client.css) throw Error('BUILD_FAILED');
  return { client, renderer };
}
