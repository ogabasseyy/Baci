export const EXPERIENCE_STARTER_PERFORMANCE_BUDGET = {
  version: 'starter-v1',
  javascriptBytes: 256 * 1024,
  cssBytes: 32 * 1024,
  htmlBytes: 128 * 1024,
  imageBytes: 256 * 1024,
  fontBytes: 128 * 1024,
} as const;

export type CandidatePerformanceResource =
  | 'javascript'
  | 'css'
  | 'ssr-html'
  | 'png-asset'
  | 'font-asset';

export class CandidatePerformanceBudgetError extends Error {
  readonly code = 'PERFORMANCE_BUDGET_EXCEEDED';

  constructor(
    readonly resource: CandidatePerformanceResource,
    readonly actualBytes: number,
    readonly maxBytes: number
  ) {
    super(`PERFORMANCE_BUDGET_EXCEEDED:${resource}`);
    this.name = 'CandidatePerformanceBudgetError';
  }
}

export interface CandidatePerformanceBudgetInput {
  javascript: string;
  css: string;
  ssrHtml?: string;
  assets: ReadonlyArray<{
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>;
}

function enforce(
  resource: CandidatePerformanceResource,
  actualBytes: number,
  maxBytes: number
) {
  if (actualBytes > maxBytes)
    throw new CandidatePerformanceBudgetError(resource, actualBytes, maxBytes);
}

/** Checks verified compiler output and materialized asset bytes, without timing claims. */
export function assertCandidatePerformanceBudget(
  input: CandidatePerformanceBudgetInput
) {
  const budget = EXPERIENCE_STARTER_PERFORMANCE_BUDGET;
  enforce(
    'javascript',
    Buffer.byteLength(input.javascript, 'utf8'),
    budget.javascriptBytes
  );
  enforce('css', Buffer.byteLength(input.css, 'utf8'), budget.cssBytes);
  if (input.ssrHtml !== undefined)
    enforce(
      'ssr-html',
      Buffer.byteLength(input.ssrHtml, 'utf8'),
      budget.htmlBytes
    );
  for (const asset of input.assets) {
    const decoded = Buffer.from(asset.bytesBase64, 'base64');
    if (decoded.toString('base64') !== asset.bytesBase64)
      throw Error('BUILD_FAILED');
    if (asset.mime === 'image/png')
      enforce('png-asset', decoded.byteLength, budget.imageBytes);
    else enforce('font-asset', decoded.byteLength, budget.fontBytes);
  }
}
