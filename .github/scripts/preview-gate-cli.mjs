import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runDroppedRefsGate } from './preview-dropped-refs-gate.mjs';
import { verifyServedPreview } from './preview-served-smoke.mjs';
import { createPreviewRequest } from './preview-vercel-request.mjs';

const execute = promisify(execFile);

export async function executePreviewGate({
  manifestPath,
  origin,
  runner,
  inspect,
  smoke,
  automationSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
}) {
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 5 * 1024 * 1024)
    throw new Error('Invalid preview manifest file');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const request = createPreviewRequest({ origin, runner });
  return runDroppedRefsGate({
    manifest,
    inspect:
      inspect ??
      (async () => {
        try {
          const { stdout } = await execute(
            runner,
            [
              'inspect',
              '--wait',
              '--timeout',
              '5m',
              '--format',
              'json',
              origin,
            ],
            { timeout: 310000, maxBuffer: 1024 * 1024 }
          );
          return JSON.parse(stdout).readyState;
        } catch {
          throw new Error('Preview readiness inspection failed');
        }
      }),
    smoke: async () => {
      if (!automationSecret?.trim())
        throw new Error('A configured automation bypass secret is required');
      return smoke
        ? smoke()
        : verifyServedPreview({ origin, route: '/ogabassey.com', request });
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  executePreviewGate({
    manifestPath: process.argv[2],
    origin: process.argv[3],
    runner: process.argv[4],
  })
    .then((result) => console.log(`Dropped reference smoke check: ${result}`))
    .catch((error) => {
      console.error(`Dropped reference smoke check failed: ${error.message}`);
      process.exitCode = 1;
    });
}
