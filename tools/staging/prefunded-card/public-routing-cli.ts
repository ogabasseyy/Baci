import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderPublicRoutingCandidate } from './public-routing-candidate';

const KNOWN_OPTIONS = new Set([
  '--vercel-baseline',
  '--vercel-sha256',
  '--nginx-baseline',
  '--nginx-sha256',
  '--readiness',
  '--readiness-sha256',
  '--out-dir',
]);

function parseOptions(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !KNOWN_OPTIONS.has(key) || !value || options.has(key))
      throw new Error('Invalid candidate arguments');
    options.set(key, value);
  }
  const required = [
    '--vercel-baseline',
    '--vercel-sha256',
    '--nginx-baseline',
    '--nginx-sha256',
    '--out-dir',
  ];
  if (
    required.some((key) => !options.has(key)) ||
    options.has('--readiness') !== options.has('--readiness-sha256')
  )
    throw new Error('Candidate arguments are incomplete');
  return options;
}

function requiredOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error('Candidate arguments are incomplete');
  return value;
}

async function writeCandidateFiles(
  output: string,
  files: Record<string, string>
): Promise<void> {
  await mkdir(output, { recursive: true });
  const missing: [string, string][] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(output, name);
    try {
      if ((await readFile(path, 'utf8')) !== content)
        throw new Error(
          'Candidate output already exists with different content'
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.push([path, content]);
    }
  }
  for (const [path, content] of missing)
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
}

async function main(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const candidate = renderPublicRoutingCandidate({
    vercelBytes: await readFile(requiredOption(options, '--vercel-baseline')),
    vercelSha256: requiredOption(options, '--vercel-sha256'),
    nginxBytes: await readFile(requiredOption(options, '--nginx-baseline')),
    nginxSha256: requiredOption(options, '--nginx-sha256'),
    ...(options.has('--readiness')
      ? {
          readinessBytes: await readFile(
            requiredOption(options, '--readiness')
          ),
          readinessSha256: requiredOption(options, '--readiness-sha256'),
        }
      : {}),
  });
  await writeCandidateFiles(requiredOption(options, '--out-dir'), {
    'vercel-routing.candidate.json': candidate.vercel,
    'staging-auth-nginx.candidate.conf': candidate.nginx,
    'readiness.candidate.json': candidate.manifest,
  });
}

main(process.argv.slice(2)).catch(() => {
  console.error(
    'Public routing candidate refused; inspect inputs and checksums.'
  );
  process.exitCode = 1;
});
