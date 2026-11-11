/** Trusted local-only test profile: no remote provider or production fetches. */
import {
  isLocalFixtureFetch,
  localHeaderSetter,
} from './local-process-policy.mjs';

const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string' || input instanceof URL ? input : input.url;
  if (!isLocalFixtureFetch(url))
    return Promise.reject(Error('LOCAL_FIXTURE_REMOTE_FETCH_DENIED'));
  return original(input, init);
};

await import(
  '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-runtime-profile.mjs'
).then((m) => m.install());
// The later startup checkpoint will configure a production execution origin.
// This owned process admits only its fixed local fixture gateway and Data API.
const { ServerResponse } = await import('node:http');
ServerResponse.prototype.setHeader = localHeaderSetter(
  ServerResponse.prototype.setHeader,
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
);

const { Server } = await import('node:http');
const { readFileSync } = await import('node:fs');
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (
    event === 'request' &&
    args[0]?.url?.split('?')[0] === '/__experience-local-fixture.png'
  ) {
    const res = args[1];
    if (args[0].method !== 'GET') {
      res.writeHead(405);
      res.end();
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    });
    res.end(
      readFileSync(
        new URL(
          '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-synthetic-device.png',
          import.meta.url
        )
      )
    );
    return true;
  }
  return emit.call(this, event, ...args);
};
