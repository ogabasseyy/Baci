import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const imageSizeRoot = dirname(require.resolve('image-size/package.json'));

function runMalformedImageScript(script: string) {
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 1_000,
  });
}

describe('bugfix: image-size zero-length parser loops', () => {
  it('rejects a zero-length ICNS entry without blocking the process', () => {
    const icnsPath = join(imageSizeRoot, 'dist/types/icns.js');
    const result = runMalformedImageScript(`
      const { ICNS } = require(${JSON.stringify(icnsPath)});
      const input = Buffer.alloc(16);
      input.write('icns', 0, 'ascii');
      input.writeUInt32BE(16, 4);
      input.write('ic07', 8, 'ascii');
      input.writeUInt32BE(0, 12);
      ICNS.calculate(input);
    `);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
  });

  it('rejects a zero-length JXL box without blocking the process', () => {
    const jxlPath = join(imageSizeRoot, 'dist/types/jxl.js');
    const result = runMalformedImageScript(`
      const { JXL } = require(${JSON.stringify(jxlPath)});
      const input = Buffer.alloc(8);
      input.writeUInt32BE(0, 0);
      input.write('jxlp', 4, 'ascii');
      JXL.calculate(input);
    `);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
  });

  it('keeps the package patch guards installed', () => {
    const boxSource = readFileSync(
      join(imageSizeRoot, 'dist/types/utils.js'),
      'utf8'
    );
    const icnsSource = readFileSync(
      join(imageSizeRoot, 'dist/types/icns.js'),
      'utf8'
    );

    expect(boxSource).toContain('boxSize < 8');
    expect(icnsSource).toContain('Invalid ICNS entry length');
  });
});
