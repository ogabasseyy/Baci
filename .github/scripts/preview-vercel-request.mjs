import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const maxBytes = 5 * 1024 * 1024;

export function createPreviewRequest({
  origin,
  runner,
  execute = execFileAsync,
}) {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    !/^baci-[a-z0-9-]+-basseys-projects-d7395611\.vercel\.app$/i.test(
      base.hostname
    ) ||
    base.port ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid preview origin');
  return async (destination) => {
    const url = new URL(destination);
    if (url.origin !== base.origin || url.username || url.password || url.hash)
      throw new Error('Invalid preview destination');
    const directory = await mkdtemp(join(tmpdir(), 'baci-preview-smoke-'));
    const bodyPath = join(directory, 'body');
    const headersPath = join(directory, 'headers');
    try {
      const result = await execute(
        runner,
        [
          'curl',
          `${url.pathname}${url.search}`,
          '--deployment',
          base.origin,
          '--',
          '--silent',
          '--show-error',
          '--max-time',
          '20',
          '--max-filesize',
          String(maxBytes),
          '--output',
          bodyPath,
          '--dump-header',
          headersPath,
          '--write-out',
          '%{http_code}',
        ],
        { maxBuffer: 4096, timeout: 30000 }
      );
      const code = result.stdout.trim();
      if (
        !/^\d{3}$/.test(code) ||
        (await stat(bodyPath)).size > maxBytes ||
        (await stat(headersPath)).size > 65536
      )
        throw new Error('Invalid response');
      const headers = await readFile(headersPath, 'utf8');
      const contentTypes = [
        ...headers.matchAll(/^content-type:\s*([^\r\n]*)/gim),
      ];
      return {
        status: Number(code),
        contentType: contentTypes.at(-1)?.[1] ?? '',
        body: (await readFile(bodyPath)).toString('utf8'),
      };
    } catch {
      throw new Error('Preview request failed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
