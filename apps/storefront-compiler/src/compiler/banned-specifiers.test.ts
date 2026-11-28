import { describe, expect, it } from 'vitest';
import {
  BANNED_MERCHANT_SUBPATH_SPECIFIERS,
  isProhibitedImportSpecifier,
} from './banned-specifiers';

describe('banned-specifiers', () => {
  it('blocks Node/Cloudflare/HTTP/file runtime specifiers while allowing standard React and SDK packages', () => {
    for (const blocked of [
      'fs',
      'fs/promises',
      'child_process',
      'node:fs',
      'cloudflare:sockets',
      'workerd:unsafe',
      'https://evil.example/mod.js',
      'data:text/javascript,export default 1',
      'file:///etc/passwd',
    ]) {
      expect(isProhibitedImportSpecifier(blocked)).toBe(true);
    }

    for (const allowed of [
      'react',
      'react/jsx-runtime',
      '@baci/experience-sdk',
      '@baci/shared',
      'framer-motion',
      './components/Hero',
    ]) {
      expect(isProhibitedImportSpecifier(allowed)).toBe(false);
    }

    expect(BANNED_MERCHANT_SUBPATH_SPECIFIERS.has('react-dom/client')).toBe(
      true
    );
    expect(BANNED_MERCHANT_SUBPATH_SPECIFIERS.has('react-dom/server')).toBe(
      true
    );
    expect(BANNED_MERCHANT_SUBPATH_SPECIFIERS.has('react/jsx-runtime')).toBe(
      false
    );
  });
});
