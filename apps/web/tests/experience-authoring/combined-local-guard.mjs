/** Local test process only: never contact external services. */
import { pathToFileURL } from 'node:url';
import { isLocalFixtureFetch } from '../experience-commerce/local-process-policy.mjs';

const runtime = process.env.BACI_SYNTHETIC_RUNTIME_PATH;
if (!runtime?.startsWith('/var/folders/') || !runtime.endsWith('/runtime.mjs'))
  throw Error('LOCAL_FIXTURE_REQUIRED');
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string' || input instanceof URL ? input : input.url;
  if (!isLocalFixtureFetch(url))
    return Promise.reject(Error('LOCAL_FIXTURE_REMOTE_FETCH_DENIED'));
  return originalFetch(input, init);
};
await import(pathToFileURL(runtime).href).then((module) => module.install());
const { ServerResponse } = await import('node:http');
const originalHeader = ServerResponse.prototype.setHeader;
ServerResponse.prototype.setHeader = function (name, value) {
  let headerValue = value;
  if (
    name.toLowerCase() === 'content-security-policy' &&
    typeof value === 'string'
  ) {
    headerValue = /frame-src [^;]*/.test(value)
      ? value.replace(
          /frame-src ([^;]*)/,
          (_, sources) =>
            `frame-src ${sources} https://output.synthetic-output.test`
        )
      : `${value}; frame-src 'self' https://output.synthetic-output.test`;
    const data = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
    headerValue = /connect-src [^;]*/.test(headerValue)
      ? headerValue.replace(
          /connect-src ([^;]*)/,
          (_, sources) => `connect-src ${sources} ${data}`
        )
      : `${headerValue}; connect-src 'self' ${data}`;
  }
  return originalHeader.call(this, name, headerValue);
};
