const {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs') as typeof import('node:fs');
const { tmpdir } = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { execFile } = require('node:child_process') as typeof import('node:child_process');

const mobilePackage = require('../package.json') as {
  scripts: { test: string };
};
const jestConfig = require('../jest.config.js') as {
  maxWorkers?: number;
  workerIdleMemoryLimit?: string;
};
const jestRunner = path.join(__dirname, 'run-jest.cjs');

async function runWorkerPidProbe(
  deadlineAt: number,
  workerIdleMemoryLimit?: string
): Promise<string[]> {
  const probeRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'mobile-jest-memory-'))
  );
  const pidFile = path.join(probeRoot, 'worker-pids.txt');
  const suites = Array.from({ length: 4 }, (_, index) => {
    const suitePath = path.join(probeRoot, `suite-${index}.test.js`);
    writeFileSync(
      suitePath,
      [
        "const fs = require('node:fs');",
        "test('records the Jest worker process', () => {",
        '  fs.appendFileSync(process.env.JEST_WORKER_PID_FILE, `${process.pid}\\n`);',
        '});',
        '',
      ].join('\n')
    );
    return suitePath;
  });

  try {
    const config = {
      rootDir: probeRoot,
      testEnvironment: 'node',
      testMatch: ['**/suite-*.test.js'],
      maxWorkers: jestConfig.maxWorkers,
      ...(workerIdleMemoryLimit ? { workerIdleMemoryLimit } : {}),
    };
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          '--no-sparkplug',
          jestRunner,
          '--config',
          JSON.stringify(config),
          '--runTestsByPath',
          ...suites,
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env: { ...process.env, JEST_WORKER_PID_FILE: pidFile },
          timeout: Math.max(1, deadlineAt - Date.now()),
          maxBuffer: 1_000_000,
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });
    return readFileSync(pidFile, 'utf8').trim().split(/\s+/);
  } finally {
    rmSync(probeRoot, { force: true, recursive: true });
  }
}

describe('bugfix: Node 24 Sparkplug GC crash in the full Jest suite', () => {
  it('disables Sparkplug before Jest creates test VM contexts', () => {
    expect(process.execArgv).toContain('--no-sparkplug');
  });
});

describe('mobile storefront Jest memory lifecycle', () => {
  it('uses bounded Jest workers and a configured idle-memory recycling policy', () => {
    const jestCommand = mobilePackage.scripts.test.split('&&', 1)[0];

    expect(jestCommand).not.toContain('--runInBand');
    expect(jestConfig.maxWorkers).toBe(2);
    expect(jestConfig.workerIdleMemoryLimit).toBeTruthy();
  });

  it(
    'reuses worker PIDs without a limit and recycles them with a tiny test limit',
    async () => {
      const probeDeadline = Date.now() + 25_000;
      const withoutLimit = await runWorkerPidProbe(probeDeadline);
      const withLimit = await runWorkerPidProbe(probeDeadline, '1KB');
      const reusedPidCount = new Set(withoutLimit).size;
      const recycledPidCount = new Set(withLimit).size;

      expect(withoutLimit).toHaveLength(4);
      expect(reusedPidCount).toBeLessThan(withoutLimit.length);
      expect(withLimit).toHaveLength(4);
      expect(recycledPidCount).toBeGreaterThan(reusedPidCount);
      expect(recycledPidCount).toBe(withLimit.length);
    },
    // This infrastructure-only case starts two child Jest runs; their combined
    // deadline is 25 seconds. Other app assertion timeouts are untouched.
    30_000
  );

  it('keeps the non-Jest native/config test stage in the package test script', () => {
    expect(mobilePackage.scripts.test).toContain(
      'node --test ios/podfile-precompiled-modules-precedence.test.mjs android/settings-gradle-include-build.test.mjs config/*.test.mjs'
    );
  });
});
