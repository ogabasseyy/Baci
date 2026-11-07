import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createAndroidBenchmarkGradleInit } from './android-benchmark-gradle.mjs';

const wrapper = readFileSync(new URL('../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8');
const version = wrapper.match(/gradle-([\d.]+)-bin\.zip/)?.[1];
const cache = join(homedir(), '.gradle/wrapper/dists', `gradle-${version}-bin`);
const gradle = existsSync(cache) ? readdirSync(cache).map((entry) => join(cache, entry, `gradle-${version}/bin/gradle`)).find(existsSync) : undefined;

test('client environment changes refresh the JS bundle while unrelated native output stays cached', { skip: !gradle && 'Gradle distribution is not cached locally' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-gradle-regression-'));
  try {
    writeFileSync(join(dir, 'settings.gradle'), "rootProject.name = 'app'\n");
    writeFileSync(join(dir, 'benchmark.gradle'), createAndroidBenchmarkGradleInit({ suffix: '' }));
    writeFileSync(join(dir, 'build.gradle'), `
tasks.register('nativeCompile') {
  outputs.file('native-count.txt')
  doLast { file('native-count.txt').text = (file('native-count.txt').exists() ? file('native-count.txt').text.toInteger() + 1 : 1).toString() }
}
tasks.register('createBundleReleaseJsAndAssets') {
  dependsOn 'nativeCompile'
  outputs.file('bundle.txt')
  doLast { file('bundle.txt').text = System.getenv('BENCHMARK_FIXTURE_MODE') }
}
`);
    for (const mode of ['baseline', 'diagnostic']) {
      const javaHome = process.env.JAVA_HOME || ['/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'].find(existsSync);
      const run = spawnSync(gradle, ['--no-daemon', '--offline', '--no-configuration-cache', '--max-workers=2', '-Dorg.gradle.jvmargs=-Xmx512m -XX:ActiveProcessorCount=2', '--console=plain', '--init-script', join(dir, 'benchmark.gradle'), 'createBundleReleaseJsAndAssets'], { cwd: dir, env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}), BENCHMARK_FIXTURE_MODE: mode }, encoding: 'utf8', timeout: 120000 });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.equal(readFileSync(join(dir, 'bundle.txt'), 'utf8'), mode);
    }
    assert.equal(readFileSync(join(dir, 'native-count.txt'), 'utf8'), '1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
