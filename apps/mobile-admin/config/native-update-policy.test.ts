// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('checked-in admin Android retains its disabled OTA policy', () => {
  const manifest = readFileSync(
    new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
    'utf8'
  );
  expect(manifest).toMatch(
    /android:name="expo\.modules\.updates\.ENABLED" android:value="false"/
  );
});
it('checked-in admin iOS retains its disabled OTA policy', () => {
  const plist = readFileSync(
    new URL(
      '../ios/BaciTheEcommerceBuilder/Supporting/Expo.plist',
      import.meta.url
    ),
    'utf8'
  );
  expect(plist).toMatch(/<key>EXUpdatesEnabled<\/key>\s*<false\/>/);
});
