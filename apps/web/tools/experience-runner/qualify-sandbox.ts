/** Read-only prerequisite probe. Readiness is not sandbox qualification. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sandboxPrerequisites } from './sandbox-policy';
export function probeSandbox(
  readHost: () => { os: string; runtimes: string[]; images?: string[] },
  image: string | null
) {
  let host: { os: string; runtimes: string[]; images?: string[] } = {
    os: 'unavailable',
    runtimes: [],
  };
  try {
    host = readHost();
  } catch {
    /* Explicit unavailable result, no weaker executor. */
  }
  const verifiedImage = image && host.images?.includes(image) ? image : null;
  const blockers = sandboxPrerequisites({ ...host, image: verifiedImage });
  return {
    checkpoint: 'A',
    status: blockers.length ? 'BLOCKED' : 'PREREQUISITES_READY',
    ...host,
    blockers,
    authoredExecutionStarted: false,
    qualified: false,
  };
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const result = probeSandbox(() => {
    const info = JSON.parse(
      execFileSync(
        'docker',
        ['--context', 'colima', 'info', '--format', '{{json .}}'],
        {
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: process.env.HOME ?? '',
            LANG: 'C.UTF-8',
          },
        }
      )
    ) as { OSType: string; Runtimes: Record<string, unknown> };
    let images: string[] = [];
    const requested = process.argv[2];
    if (requested && /^sha256:[a-f0-9]{64}$/.test(requested)) {
      try {
        const actual = execFileSync(
          'docker',
          [
            '--context',
            'colima',
            'image',
            'inspect',
            requested,
            '--format',
            '{{.Id}}',
          ],
          {
            encoding: 'utf8',
            timeout: 10000,
            maxBuffer: 4096,
            env: {
              PATH: process.env.PATH ?? '/usr/bin:/bin',
              HOME: process.env.HOME ?? '',
              LANG: 'C.UTF-8',
            },
          }
        ).trim();
        if (actual === requested) images = [actual];
      } catch {
        /* Missing or inaccessible image remains unavailable. */
      }
    }
    return { os: info.OSType, runtimes: Object.keys(info.Runtimes), images };
  }, process.argv[2] ?? null);
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'BLOCKED' ? 1 : 0;
}
