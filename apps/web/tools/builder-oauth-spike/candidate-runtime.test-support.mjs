import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const candidateRoot = resolve(
  process.env.BACI_OAUTH_CANDIDATE_DIR ??
    new URL('./candidate', import.meta.url).pathname
);
const versions = {
  'oidc-provider': '9.12.2',
  'openid-client': '6.8.8',
  jose: '6.2.12',
};
export function loadCandidate(name) {
  assert(Object.hasOwn(versions, name), 'Unrecognized candidate dependency');
  assert.equal(
    JSON.parse(
      readFileSync(
        resolve(candidateRoot, 'node_modules', name, 'package.json'),
        'utf8'
      )
    ).version,
    versions[name]
  );
  return import(
    pathToFileURL(
      createRequire(resolve(candidateRoot, 'package.json')).resolve(name)
    ).href
  );
}
