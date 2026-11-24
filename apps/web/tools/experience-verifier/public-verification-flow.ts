import { isDeepStrictEqual } from 'node:util';
import {
  type PublicVerificationExpected,
  verifyPublicExperience,
} from '@/lib/experience/public-verifier';

type Binding = {
  receiptId: string;
  effectDigest: string;
  buildDigest: string;
  publicationRevision: number;
  scriptDigest: string;
  styleDigest: string;
  assets: Record<string, string>;
};

/** Trusted dependencies only. This does not install an observer or enable publication. */
export function createPublicVerificationFlow<
  B extends Binding,
  F,
  P,
  E extends PublicVerificationExpected,
>(deps: {
  bind(id: string, accept?: () => void): Promise<B>;
  fetchOutput(binding: B): Promise<F>;
  deriveExpected(binding: B): Promise<E>;
  fetchPages(binding: B, expected: E): Promise<P>;
  observe(binding: B, output: F, pages: P, expected: E): Promise<unknown>;
  record(input: {
    receiptId: string;
    effectDigest: string;
    markerDigest: string;
  }): Promise<void>;
}) {
  return async (id: string, signal?: AbortSignal, accept?: () => void) => {
    signal?.throwIfAborted();
    const binding = await deps.bind(id, accept);
    signal?.throwIfAborted();
    const output = await deps.fetchOutput(binding);
    signal?.throwIfAborted();
    const expected = await deps.deriveExpected(binding);
    if (
      expected.buildDigest !== binding.buildDigest ||
      expected.publicationRevision !== binding.publicationRevision ||
      expected.scriptDigest !== binding.scriptDigest ||
      expected.styleDigest !== binding.styleDigest ||
      !isDeepStrictEqual(expected.assets, binding.assets)
    )
      throw Error('PUBLIC_BINDING_MISMATCH');
    signal?.throwIfAborted();
    const pages = await deps.fetchPages(binding, expected);
    return verifyPublicExperience(expected, {
      observe: () => {
        signal?.throwIfAborted();
        return deps.observe(binding, output, pages, expected);
      },
      current: async () => {
        signal?.throwIfAborted();
        const current = await deps.bind(id);
        if (!isDeepStrictEqual(current, binding))
          throw Error('PUBLICATION_SUPERSEDED');
        return current;
      },
      record: (markerDigest) => {
        signal?.throwIfAborted();
        return deps.record({
          receiptId: binding.receiptId,
          effectDigest: binding.effectDigest,
          markerDigest,
        });
      },
    });
  };
}
