import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEvidenceTree } from './evidence-tree-scan';

describe('evidence tree scanner', () => {
  it('reports zero findings for the strict bound evidence tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(directory, 'README.md'),
      await readFile(new URL('../evidence/0a-core/README.md', import.meta.url))
    );
    await writeFile(
      join(directory, 'public-contract.json'),
      await readFile(
        new URL('../evidence/0a-core/public-contract.json', import.meta.url)
      )
    );

    await expect(scanEvidenceTree(directory)).resolves.toEqual({
      filesScanned: 2,
      findings: 0,
    });
  });

  it.each([
    ['credential', { apiKey: 'secret' }],
    ['email', { value: 'merchant@example.com' }],
    ['private host', { value: 'http://localhost:3000/private' }],
    ['IPv6 loopback', { value: 'http://[::1]/private' }],
    ['IPv6 unique-local host', { value: 'http://[fc00::1]/private' }],
    ['IPv6 link-local host', { value: 'http://[fe80::1]/private' }],
    ['raw body', { rawBody: 'response' }],
    ['Postman environment', { postmanEnvironment: 'production' }],
  ])('rejects unrecognized artifact containing %s without echoing it', async (_name, unsafe) => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    const path = join(directory, 'unsupported.json');
    await writeFile(path, JSON.stringify(unsafe), 'utf8');

    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });

  it('rejects an identity field hidden in a recognized artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(directory, 'live-read-observation.json'),
      JSON.stringify({ merchantReference: 'merchant-123' }),
      'utf8'
    );

    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });

  it('rejects unsupported regular files and symbolic links explicitly', async () => {
    const unsupportedDirectory = await mkdtemp(
      join(tmpdir(), 'chowdeck-scan-')
    );
    await writeFile(
      join(unsupportedDirectory, 'notes.txt'),
      'safe prose',
      'utf8'
    );
    await expect(scanEvidenceTree(unsupportedDirectory)).rejects.toThrow(
      'Unsafe evidence tree'
    );

    const symlinkDirectory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    const target = join(symlinkDirectory, 'target.md');
    await writeFile(target, 'safe prose', 'utf8');
    await symlink(target, join(symlinkDirectory, 'README.md'));
    await expect(scanEvidenceTree(symlinkDirectory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects oversized files and deeply nested directories', async () => {
    const large = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(join(large, 'public-contract.json'), 'x'.repeat(1_048_577));
    await expect(scanEvidenceTree(large)).rejects.toThrow(
      'Unsafe evidence tree'
    );
    const deep = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await mkdir(join(deep, ...Array.from({ length: 34 }, () => 'd')), {
      recursive: true,
    });
    await expect(scanEvidenceTree(deep)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });

  it('bounds traversal even when the tree contains only empty directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    for (let i = 0; i < 257; i += 1) await mkdir(join(root, String(i)));
    await expect(scanEvidenceTree(root)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects duplicate keys and sensitive material embedded in keys', async () => {
    const duplicate = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(duplicate, 'receipt.json'),
      '{"value":"merchant@example.com","value":"safe"}'
    );
    await expect(scanEvidenceTree(duplicate)).rejects.toThrow(
      'Unsafe evidence tree'
    );
    const key = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(key, 'receipt.json'),
      JSON.stringify({ 'merchant@example.com': 'safe' })
    );
    await expect(scanEvidenceTree(key)).rejects.toThrow('Unsafe evidence tree');
  });
  it('rejects identity or secret assignments in Markdown without echoing them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(directory, 'notes.md'),
      'password: synthetic-password-123\nmerchantReference: synthetic-merchant-123'
    );
    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects sensitive assignments in fenced JSON embedded in Markdown', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(directory, 'notes.md'),
      '```json\n{"apiKey":"synthetic-key-123456","merchantReference":"synthetic-merchant-123"}\n```'
    );
    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects unknown evidence files even when the content looks harmless', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(
      join(directory, 'arbitrary.json'),
      JSON.stringify({ note: 'innocent' })
    );
    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects modified README content even if it has no obvious secret pattern', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    await writeFile(join(directory, 'README.md'), 'innocent freeform text');
    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
  it('rejects a recognized receipt with a forged digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-scan-'));
    const original = JSON.parse(
      await readFile(
        new URL('../evidence/0a-core/public-contract.json', import.meta.url),
        'utf8'
      )
    );
    original.digest = `sha256:${'0'.repeat(64)}`;
    await writeFile(
      join(directory, 'public-contract.json'),
      JSON.stringify(original)
    );
    await expect(scanEvidenceTree(directory)).rejects.toThrow(
      'Unsafe evidence tree'
    );
  });
});
