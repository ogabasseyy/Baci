import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPathFromRepositoryRoot = resolve(
  process.cwd(),
  'tools/staging/prefunded-card/legacy-history-cli.ts'
);
const cliPathFromWebRoot = resolve(
  process.cwd(),
  '../../tools/staging/prefunded-card/legacy-history-cli.ts'
);
const source = readFileSync(
  existsSync(cliPathFromRepositoryRoot)
    ? cliPathFromRepositoryRoot
    : cliPathFromWebRoot,
  'utf8'
);

describe('read-only history command', () => {
  it('uses a fixed private credential source and refuses symlinks, permissive parents and foreign owners', () => {
    expect(source).toContain(
      '/home/bassey/pvb-staging-receipts/intake-config.json'
    );
    expect(source).toContain('constants.O_NOFOLLOW');
    expect(source).toContain('metadata.nlink !== 1');
    expect(source).toContain('directory.uid !== expectedOwner');
    expect(source).toContain('(directory.mode & 0o077) !== 0');
  });
  it('requires explicit root mode and resolves only the fixed credential custodian', () => {
    expect(source).toContain("process.argv[2] === '--owner-read-only'");
    expect(source).toContain('(ownerRead && process.getuid?.() !== 0)');
    expect(source).toContain("execFileSync('/usr/bin/id', ['-u', 'bassey']");
    expect(source).toContain('metadata.uid !== process.getuid?.()');
    expect(source).toContain('expectedOwner <= 0');
  });
  it('writes a private no-clobber proof and only prints the metadata summary', () => {
    expect(source).toContain("mode: 0o600, flag: 'wx'");
    expect(source).toContain("process.argv[2] !== '--read-only'");
    expect(source).not.toContain('console.log(JSON.stringify(proof))');
    expect(source).not.toContain('sudo');
    expect(source).not.toContain('systemctl');
    expect(source.match(/assertLegacyProofPublicationTime\(/g)).toHaveLength(2);
  });
  it('uses the distinct psql locations of the two installed database images', () => {
    expect(source).toContain("container === 'pvb-staging-receipts-db'");
    expect(source).toContain("'/usr/local/bin/psql'");
    expect(source).toContain("'/nix/var/nix/profiles/default/bin/psql'");
  });
});
