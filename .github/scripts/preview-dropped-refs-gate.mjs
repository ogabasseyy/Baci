import { countDroppedRefs } from './preview-dropped-refs.mjs';

export async function runDroppedRefsGate({ manifest, inspect, smoke }) {
  if (countDroppedRefs(manifest) === 0) return 'skipped';
  if ((await inspect()) !== 'READY') throw new Error('Preview is not READY');
  await smoke();
  return 'passed';
}
