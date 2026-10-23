import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
export function createTestBrowser(issuer: string) {
  const jar = new Map<string, { value: string; path: string }>();
  function send(path: string, form?: Record<string, string>) {
    const url = new URL(path, issuer);
    assert.equal(url.origin, issuer);
    return new Promise<{ status: number; location?: string; text: string }>(
      (resolve, reject) => {
        const body = form ? new URLSearchParams(form).toString() : undefined;
        const req = httpsRequest(
          url,
          {
            rejectUnauthorized: false,
            agent: false,
            method: form ? 'POST' : 'GET',
            headers: {
              cookie: [...jar]
                .filter(([, c]) => url.pathname.startsWith(c.path))
                .map(([name, c]) => `${name}=${c.value}`)
                .join('; '),
              ...(form
                ? {
                    ...(url.pathname.startsWith('/interaction/')
                      ? { origin: issuer }
                      : {}),
                    'content-type': 'application/x-www-form-urlencoded',
                    'content-length': String(Buffer.byteLength(body ?? '')),
                  }
                : {}),
            },
          },
          (res) => {
            for (const cookie of res.headers['set-cookie'] ?? []) {
              const [pair, ...attrs] = cookie.split(';');
              assert(pair);
              const at = pair.indexOf('=');
              const name = pair.slice(0, at);
              const value = pair.slice(at + 1);
              const path =
                attrs
                  .find((a) => a.trim().toLowerCase().startsWith('path='))
                  ?.trim()
                  .slice(5) ?? '/';
              if (!value) jar.delete(name);
              else jar.set(name, { value, path });
            }
            let text = '';
            res.on('data', (c) => {
              text += c;
            });
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 500,
                location: res.headers.location,
                text,
              })
            );
          }
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('Fixture timeout')));
        req.end(body);
      }
    );
  }

  return { jar, send };
}

export function requireString(value: string | null | undefined): string {
  assert(value);
  return value;
}
