import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { preparePlatformBlogRelease } from './prepare-platform-blog-release';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: prepare-platform-blog-release-cli.ts handoff.json payload.json'
  );
}
const input: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
// Reuse the browser's spec-parsing checks in this operator-only Node tool.
// Script execution and resource loading remain disabled in jsdom.
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;
const payload = preparePlatformBlogRelease(input);
writeFileSync(outputPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: 'prepared', slug: payload.slug }));
