import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function createUpstreamClient(issuer, client) {
  const candidate = resolve(
    process.env.BACI_OAUTH_CANDIDATE_DIR ??
      new URL('./candidate', import.meta.url).pathname
  );
  const oidc = await import(
    pathToFileURL(
      resolve(candidate, 'node_modules/openid-client/build/index.js')
    )
  );
  const customFetch = (url, options = {}) => {
    assert.equal(new URL(url).origin, issuer);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          agent: false,
          rejectUnauthorized: false,
          method: options.method,
          headers: Object.fromEntries(new Headers(options.headers)),
        },
        (res) => {
          const chunks = [];
          res.on('data', (data) => chunks.push(data));
          res.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: res.headers,
              })
            );
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () =>
        req.destroy(new Error('Upstream fixture timeout'))
      );
      req.end(
        options.body instanceof URLSearchParams
          ? options.body.toString()
          : options.body
      );
    });
  };
  const config = await oidc.discovery(
    new URL(issuer),
    client.body.client_id,
    client.body.client_secret,
    oidc.ClientSecretPost(client.body.client_secret),
    { [oidc.customFetch]: customFetch }
  );
  return { oidc, config };
}
