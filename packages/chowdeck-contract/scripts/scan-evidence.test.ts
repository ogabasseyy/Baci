import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScanEvidenceCli } from './scan-evidence.mjs';

describe('evidence scanner CLI', () => {
  it('runs the safety scan when invoked through a symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-link-'));
    const link = join(directory, 'scan.mjs');
    await symlink(fileURLToPath(new URL('./scan-evidence.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, ['--import', 'tsx', link], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('evidence files:');
  });
  it.each(['capture-public-contract.mjs', 'observe-core-contract.mjs'])(
    'runs %s through a symlink and rejects invalid arguments',
    async (script) => {
      const directory = await mkdtemp(join(tmpdir(), 'chowdeck-cli-link-'));
      const link = join(directory, 'entry.mjs');
      await symlink(fileURLToPath(new URL(`./${script}`, import.meta.url)), link);
      const result = spawnSync(process.execPath, ['--import', 'tsx', link, '--invalid'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/failed/i);
    }
  );
  it('prints only a fixed count summary for a safe evidence tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-cli-'));
    await writeFile(join(directory, 'README.md'), await readFile(new URL('../evidence/0a-core/README.md', import.meta.url)));
    const output: string[] = [];

    const result = await runScanEvidenceCli({
      directory,
      writeSummary: (line: string) => output.push(line),
    });

    expect(result).toEqual({ filesScanned: 1, findings: 0 });
    expect(output).toEqual(['evidence files: 1, findings: 0']);
  });
});
