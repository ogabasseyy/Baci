import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

// The install commands live in a script so ci.yml stays small; the workflow must keep calling it.
const INSTALLER = '.github/scripts/install-supabase-replay-toolchain.sh';

function readInstaller(): string {
  const workflow = readFileSync(
    path.resolve(process.cwd(), '../../.github/workflows/ci.yml'),
    'utf8'
  );
  expect(workflow).toContain(`run: bash ${INSTALLER}`);
  return readFileSync(path.resolve(process.cwd(), '../..', INSTALLER), 'utf8');
}

describe('Supabase replay CLI installation', () => {
  it('retries a reset connection while downloading the pinned CLI archive', async () => {
    const workflow = readInstaller();
    const download = workflow.match(
      /curl[^\n]*\\\n\s*"https:\/\/github\.com\/supabase\/cli\/releases\/download\/v\$\{SUPABASE_CLI_VERSION\}\/supabase_linux_amd64\.tar\.gz"/
    );
    expect(download).not.toBeNull();
    expect(download?.[0]).toMatch(/--retry\s+[1-9]/);
    expect(download?.[0]).toContain('--retry-all-errors');

    // Exercise the actual workflow's curl options against a local server that
    // resets its first connection, matching the CI download failure.
    const options = download?.[0]
      .split('\n')[0]
      .replace(/\\\s*$/, '')
      .trim()
      .split(/\s+/)
      .slice(1);
    expect(options).toBeDefined();
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      if (requests === 1) {
        request.socket.destroy();
        return;
      }
      response.end('synthetic archive');
    });
    const directory = await mkdtemp(path.join(tmpdir(), 'baci-replay-curl-'));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string' || !options)
        throw new Error('Local test server unavailable');
      const archive = path.join(directory, 'supabase.tar.gz');
      await promisify(execFile)('curl', [
        ...options,
        '--retry-delay',
        '0',
        `http://127.0.0.1:${address.port}/archive`,
        '--output',
        archive,
      ]);
      expect(requests).toBe(2);
      expect(await readFile(archive, 'utf8')).toBe('synthetic archive');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('verifies the archive before installing the single supabase executable', () => {
    const installer = readInstaller();
    const verify = installer.indexOf(
      `echo "\${SUPABASE_CLI_SHA256}  \${SUPABASE_ARCHIVE}" | sha256sum --check`
    );
    const extract = installer.indexOf(
      `sudo tar -xz --no-same-owner -f "\${SUPABASE_ARCHIVE}" -C "\${SUPABASE_CLI_DIR}"`
    );
    const chmod = installer.indexOf(
      `sudo chmod 0755 "\${SUPABASE_CLI_DIR}/supabase"`
    );
    const check = installer.indexOf(`test -x "\${SUPABASE_CLI_DIR}/supabase"`);
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(extract).toBeGreaterThan(verify);
    expect(chmod).toBeGreaterThan(extract);
    expect(check).toBeGreaterThan(chmod);
  });

  it('keeps the pinned CLI in its own versioned folder and puts it first on PATH for this and later steps', () => {
    const installer = readInstaller();
    expect(installer).toContain(
      `SUPABASE_CLI_DIR="/opt/supabase-cli/\${SUPABASE_CLI_VERSION}"`
    );
    const exported = installer.indexOf(
      `export PATH="\${SUPABASE_CLI_DIR}:\${PATH}"`
    );
    const forLaterSteps = installer.indexOf(
      `echo "\${SUPABASE_CLI_DIR}" >> "$GITHUB_PATH"`
    );
    const firstUse = installer.indexOf('supabase --version');
    expect(exported).toBeGreaterThanOrEqual(0);
    expect(forLaterSteps).toBeGreaterThanOrEqual(0);
    expect(firstUse).toBeGreaterThan(exported);
    expect(firstUse).toBeGreaterThan(forLaterSteps);
    // Other open pull requests are still pinned to the CLI the server already has in
    // /usr/local/bin, so installing a new release there would break them.
    expect(installer).not.toContain('/usr/local/bin');
  });

  it('does not ask tar for the helper binary that CLI 3.x no longer ships', () => {
    // 3.x is one executable: naming a member that is not in the archive fails the install.
    expect(readInstaller()).not.toContain('supabase-go');
  });
});
