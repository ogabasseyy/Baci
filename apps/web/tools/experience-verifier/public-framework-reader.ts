import { createBoundPublicFetcher } from './public-fetch';
import { publicFrameworkRequest } from './public-framework-request';

type Request = { url: string; method: string; body?: string };
type Fetch = (url: string) => Promise<{ body: Buffer; contentType: string }>;

/** Host side only. The worker can request bounded public framework files, never arbitrary URLs. */
export function createPublicFrameworkReader(
  origin: string,
  fetchAsset?: Fetch
) {
  let count = 0;
  let total = 0;
  return async (request: Request) => {
    const kind = publicFrameworkRequest(origin, request);
    if (!kind || ++count > 32) throw Error('PUBLIC_FRAMEWORK_DENIED');
    const fetch =
      fetchAsset ??
      createBoundPublicFetcher({ origins: [origin], urls: [request.url] });
    const result = await fetch(request.url);
    const mime = result.contentType.split(';', 1)[0].trim().toLowerCase();
    if (
      !Buffer.isBuffer(result.body) ||
      result.body.length > 700000 ||
      (kind === 'css'
        ? mime !== 'text/css'
        : !['text/javascript', 'application/javascript'].includes(mime))
    )
      throw Error('PUBLIC_FRAMEWORK_MISMATCH');
    total += result.body.length;
    if (total > 4000000) throw Error('PUBLIC_FRAMEWORK_BUDGET');
    return {
      status: 200,
      body: JSON.stringify({ mime, bytes: result.body.toString('base64') }),
    };
  };
}
