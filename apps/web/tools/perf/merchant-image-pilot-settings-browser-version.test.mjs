import { describe, expect, it } from 'vitest';
import { verifyBrowserVersion } from './merchant-image-pilot-settings-browser-version.mjs';

describe('merchant-image-pilot-settings-browser-version', () => {
  it('checks attested browser builds against the expected major', () => {
    expect(verifyBrowserVersion('154.0.0.0', '154')).toEqual({ ok: true });
    expect(verifyBrowserVersion('153.0.0.0', '154').error).toMatch(
      /does not match Chrome 154/
    );
    expect(verifyBrowserVersion('debian-chromium', '154').error).toMatch(
      /not a dotted browser build/
    );
  });
});
