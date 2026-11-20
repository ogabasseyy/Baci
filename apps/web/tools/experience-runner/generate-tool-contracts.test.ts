import { beforeEach, expect, it, vi } from 'vitest';
import output from '../../builder-mcp-server/experience-contracts.json';
import inputs from '../../builder-mcp-server/experience-wire-inputs';
import { generateExperienceContracts } from './generate-tool-contracts';

const fs = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs', () => fs);

const target = new URL(
  '../../builder-mcp-server/experience-contracts.json',
  import.meta.url
);
const directory = new URL(
  '../../builder-mcp-server/experience-wire-inputs/',
  import.meta.url
);

beforeEach(() => vi.resetAllMocks());

it('writes the checked-in wire contract to the fixed target', () => {
  generateExperienceContracts();

  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.mkdirSync).toHaveBeenCalledExactlyOnceWith(directory, {
    recursive: true,
  });
  expect(fs.writeFileSync).toHaveBeenCalledWith(
    target,
    `${JSON.stringify(output, null, 2)}\n`
  );
  for (const [name, schema] of Object.entries(inputs))
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      new URL(`${name}.json`, directory),
      `${JSON.stringify(schema, null, 2)}\n`
    );
  expect(fs.writeFileSync).toHaveBeenCalledTimes(
    Object.keys(inputs).length + 2
  );
  for (const [, content] of fs.writeFileSync.mock.calls)
    expect(content.trimEnd().split('\n').length).toBeLessThanOrEqual(300);
});

it('checks every wire file and import index without rewriting them', async () => {
  const { readFileSync } =
    await vi.importActual<typeof import('node:fs')>('node:fs');
  fs.readFileSync.mockImplementation((path: URL) => {
    const content = readFileSync(path, 'utf8');
    return path.pathname.endsWith('.json')
      ? JSON.stringify(JSON.parse(content))
      : content;
  });

  expect(() => generateExperienceContracts(true)).not.toThrow();
  expect(fs.readFileSync).toHaveBeenCalledTimes(Object.keys(inputs).length + 2);
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});

it('rejects stale wire JSON without overwriting it', () => {
  fs.readFileSync.mockReturnValueOnce(JSON.stringify(output));
  fs.readFileSync.mockReturnValueOnce('{}');

  expect(() => generateExperienceContracts(true)).toThrow(
    'Experience contracts drift'
  );
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});
