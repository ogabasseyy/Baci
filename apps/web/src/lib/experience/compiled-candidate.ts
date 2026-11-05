import { z } from 'zod';
import { digestBytes } from './manifest-digest';

const candidate = z.strictObject({
  hostOrigin: z.string().url().optional(),
  javascript: z.string().min(1),
  css: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  imports: z.array(z.string().max(512)).max(4096),
});
export type CompiledCandidate = z.infer<typeof candidate>;
/** Independent receiver validation; a source-produced success flag grants nothing. */
export function verifyCompiledCandidate(value: unknown): CompiledCandidate {
  const r = candidate.safeParse(value);
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
