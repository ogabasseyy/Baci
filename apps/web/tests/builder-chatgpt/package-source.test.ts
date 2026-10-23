// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { implementedBuilderTools } from '../../src/schemas/builder-implemented-tools';

it('prepares an isolated, honest package source without a fabricated app or endpoint binding', () => {
  const root = new URL('../../chatgpt-builder-plugin/', import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL('plugin.json', root), 'utf8')
  );
  expect(manifest.name).toBe('baci-website-builder');
  expect(manifest.extensions['com.openai'].apps).toBeUndefined();
  const listing = manifest.extensions['com.openai'].interface;
  expect(listing.shortDescription.length).toBeLessThanOrEqual(30);
  expect(listing.longDescription).toContain(
    'separate signed-in owner approval'
  );
  for (const field of [
    'websiteURL',
    'privacyPolicyURL',
    'termsOfServiceURL',
    'supportURL',
  ])
    expect(new URL(listing[field]).origin).toBe('https://usebaci.com');
  const icon = readFileSync(new URL('assets/baci-icon.png', root));
  expect(icon.readUInt32BE(16)).toBeGreaterThanOrEqual(48);
  expect(icon.readUInt32BE(20)).toBeGreaterThanOrEqual(48);
  expect(icon.byteLength).toBeLessThan(5 * 1024 * 1024);
  expect(readdirSync(root)).not.toContain('.app.json');
  expect(readdirSync(root)).not.toContain('mcp.json');
  expect(implementedBuilderTools).toHaveLength(8);
});
