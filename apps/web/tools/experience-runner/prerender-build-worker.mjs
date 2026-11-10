/** One-shot offline compiler. Candidate code is never imported/evaluated here. */

import { readBoundedUtf8 } from './bounded-input.mjs';
import {
  bundleSource,
  unpackPrivateBuild,
} from './tools/experience-runner/bundle-source-prerender.mjs';

const input = unpackPrivateBuild(
  JSON.parse(await readBoundedUtf8(process.stdin))
);
if (!input) throw Error('Invalid private build');
const client = await bundleSource(input.manifest, {
  renderMode: 'hydrate',
  hostOrigin: input.hostOrigin,
  profile: input.profile,
  previewOrigin: input.previewOrigin,
});
const renderer = await bundleSource(input.manifest, {
  renderMode: 'prerender',
});
process.stdout.write(JSON.stringify({ client, renderer }), () =>
  process.exit(0)
);
