// Atomic bound-set publication for the bound-evidence runner: the
// complete set is staged in a sibling directory and swapped over the
// destination, so the destination always holds one complete set. Split
// from merchant-image-pilot-runner-finish.mjs under the repo line
// ceiling.
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

// Finish owns its destination directory: the only files it may replace
// are the five it writes. Anything else at the destination (another
// dir's run.json, an operator's notes) refuses instead of being swept
// into the replaced set's backup and deleted.
const BOUND_SET_NAMES = new Set([
  'browser-launch.json',
  'profile-reset.json',
  'run.har',
  'screenshot-capture.json',
  'screenshot.png',
]);

export async function publishBoundSet({
  capture,
  harJson,
  io = {},
  launch,
  out,
  resetBytes,
  screenshot,
}) {
  const fsx = {
    copyFile,
    mkdir,
    readdir,
    rename,
    rm,
    writeFile,
    ...io,
  };
  // A retry into an earlier finish of the same run replaces the five
  // bound files; anything else at the destination refuses, before
  // anything is staged. Same-dir-as-prepare refuses here too: run.json
  // is not a bound artifact, so finishing over the prepare dir would
  // delete the run handle it just read.
  const prior = await fsx
    .readdir(out, { withFileTypes: true })
    .catch((error) => {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
  if (prior !== null) {
    const foreign = prior
      .filter((entry) => !entry.isFile() || !BOUND_SET_NAMES.has(entry.name))
      .map((entry) => entry.name);
    if (foreign.length > 0) {
      throw new Error(
        `finish destination holds files outside the bound set (${foreign.join(', ')}); finish into a fresh directory: ${out}`
      );
    }
  }
  // The complete set is staged in a sibling directory (same parent, so
  // the renames never cross filesystems) and swapped over the
  // destination. A failure at any point leaves the previous set live,
  // so ENOSPC mid-publish can no longer strand a mixed set. Crash
  // windows: a missing destination (downstream reads fail closed) or
  // an inert .staging/.prev sibling beside it.
  const staged = `${out}.staging-${randomUUID()}`;
  const writeStagedJson = (name, value) =>
    fsx.writeFile(join(staged, name), `${JSON.stringify(value, null, 2)}\n`);
  await fsx.mkdir(staged, { recursive: true });
  try {
    await fsx.writeFile(
      join(staged, 'run.har'),
      `${JSON.stringify(harJson)}\n`
    );
    await writeStagedJson('screenshot-capture.json', capture);
    await fsx.copyFile(screenshot, join(staged, 'screenshot.png'));
    // Keep the bound set self-contained: the profile-reset record
    // travels with it. A run handle without its reset record is an
    // incomplete run, not a partial bind.
    await fsx.writeFile(join(staged, 'profile-reset.json'), resetBytes);
    await writeStagedJson('browser-launch.json', launch);
    const backup = `${out}.prev-${randomUUID()}`;
    try {
      await fsx.rename(out, backup);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await fsx.rename(staged, out);
    } catch (error) {
      // The old set moved aside but the new one did not land: restore
      // it, so a failed swap never leaves the destination missing.
      try {
        await fsx.rename(backup, out);
      } catch {
        // Best-effort restore: the original swap error below is the
        // failure the operator must see, and a missing destination
        // fails closed downstream.
      }
      throw error;
    }
    try {
      await fsx.rm(backup, { force: true, recursive: true });
    } catch {
      // Best-effort backup removal: a leftover .prev sibling only
      // wastes space; validators read the destination only.
    }
  } catch (error) {
    try {
      await fsx.rm(staged, { force: true, recursive: true });
    } catch {
      // Best-effort staging cleanup: the original publish error below
      // is the failure the operator must see.
    }
    throw error;
  }
  return {
    browserLaunch: join(out, 'browser-launch.json'),
    capture: join(out, 'screenshot-capture.json'),
    har: join(out, 'run.har'),
  };
}
