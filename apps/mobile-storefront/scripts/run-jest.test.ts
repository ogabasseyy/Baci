const mobilePackage = require('../package.json') as {
  scripts: { test: string };
};
const jestConfig = require('../jest.config.js') as {
  maxWorkers?: number;
  workerIdleMemoryLimit?: string;
};

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

  it('keeps the non-Jest native/config test stage in the package test script', () => {
    const testStages = mobilePackage.scripts.test
      .split('&&')
      .map((stage) => stage.trim());
    const nodeTestStage = testStages.find((stage) =>
      stage.startsWith('pnpm exec node --test ')
    );

    expect(mobilePackage.scripts.test).toContain(
      'node --test ios/podfile-precompiled-modules-precedence.test.mjs android/settings-gradle-include-build.test.mjs config/*.test.mjs'
    );
    expect(testStages).toContain(
      'pnpm exec node ios/OgabasseyStaging/SavingsLiveActivity.test.mjs'
    );
    expect(testStages).toContain(
      'pnpm exec node scripts/run-jest-memory-lifecycle.test.mjs'
    );
    expect(nodeTestStage).toBeDefined();
    expect(nodeTestStage).not.toContain('SavingsLiveActivity.test.mjs');
  });
});
