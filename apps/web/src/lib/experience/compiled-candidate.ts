import {
  type CompiledCandidate,
  compiledCandidateSchema,
} from '@/schemas/experience-compiled-candidate';
import { digestBytes } from './manifest-digest';

export type { CompiledCandidate } from '@/schemas/experience-compiled-candidate';

/** Independent receiver validation; a source-produced success flag grants nothing. */
export function verifyCompiledCandidate(value: unknown): CompiledCandidate {
  const r = compiledCandidateSchema.safeParse(value);
  if (
    !r.success ||
    Buffer.byteLength(r.data.javascript + r.data.css) > 16777216 ||
    r.data.digest !== digestBytes(`${r.data.javascript}\0${r.data.css}`) ||
    r.data.imports.some(
      (p) =>
        p.includes('://') ||
        p.startsWith('/') ||
        p.includes('\\') ||
        (!p.startsWith('source:') &&
          (/(^|\/)\.\.?(\/|$)/.test(
            p.replace(/^(?:\.\.\/){0,2}(?=node_modules\/)/, '')
          ) ||
            !/^(?:(?:\.\.\/){0,2}node_modules\/|workspace\/packages\/(?:experience-sdk|shared)\/)/.test(
              p
            )))
    )
  )
    throw Error('BUILD_FAILED');
  return r.data;
}
