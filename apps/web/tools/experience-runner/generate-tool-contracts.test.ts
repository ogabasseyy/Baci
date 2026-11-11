import { beforeEach, expect, it, vi } from 'vitest';
import contracts from '../../builder-mcp-server/experience-contracts.json';
import { generateExperienceContracts } from './generate-tool-contracts';

const fs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs', () => fs);

const target = new URL(
  '../../builder-mcp-server/experience-contracts.json',
  import.meta.url
);

beforeEach(() => vi.resetAllMocks());

it('writes the checked-in wire contract to the fixed target', () => {
  generateExperienceContracts();

  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.writeFileSync).toHaveBeenCalledExactlyOnceWith(
    target,
    `${JSON.stringify(contracts, null, 2)}\n`
  );
});

it('checks equivalent wire JSON without rewriting it', () => {
  fs.readFileSync.mockReturnValue(JSON.stringify(contracts));

  expect(() => generateExperienceContracts(true)).not.toThrow();
  expect(fs.readFileSync).toHaveBeenCalledExactlyOnceWith(target, 'utf8');
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});

it('rejects stale wire JSON without overwriting it', () => {
  fs.readFileSync.mockReturnValue(JSON.stringify({ ...contracts, inputs: {} }));

  expect(() => generateExperienceContracts(true)).toThrow(
    'Experience contracts drift'
  );
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});
