import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export function runKey(run) {
  return `${run.profile}/${run.family}/${run.sample}`;
}

export function saveManifest(file, manifest) {
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temp, file);
}

// Never delete a prior attempt: a fresh directory cannot reuse stale evidence.
export function prepareSampleDirectory(output, run) {
  if (
    ![run.profile, run.family].every((part) => /^[\w-]+$/.test(part)) ||
    !Number.isSafeInteger(run.sample) ||
    run.sample < 1
  )
    throw new Error('unsafe sample identity');
  const root = resolve(output);
  const parents = [
    root,
    join(root, run.profile),
    join(root, run.profile, run.family),
  ];
  for (const parent of parents) {
    mkdirSync(parent, { recursive: true });
    if (lstatSync(parent).isSymbolicLink())
      throw new Error('unsafe sample parent');
  }
  return mkdtempSync(join(parents[2], `sample-${run.sample}-`));
}
