import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

for (const workflow of ['android-release.yml', 'android-storefront-release.yml']) {
  test(`${workflow} installs the published Android 37.0 SDK platform`, () => {
    const source = readFileSync(new URL(`../workflows/${workflow}`, import.meta.url), 'utf8');
    assert.match(source, /packages:.*\bplatforms;android-37\.0(?:\s|$)/m);
    assert.doesNotMatch(source, /packages:.*\bplatforms;android-37(?:\s|$)/m);
  });
}
