import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const swift = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
test('native intro latch resolves early and late waiters exactly once', { skip: swift.error ? 'Swift compiler unavailable' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'splash-intro-test-'));
  try {
    const main = join(dir, 'main.swift');
    const binary = join(dir, 'test');
    writeFileSync(main, `import Foundation
let latch = IntroLatch()
var results: [String] = []
latch.wait { results.append("first:\\($0)") }
latch.wait { results.append("second:\\($0)") }
precondition(results.isEmpty)
latch.finish(true)
latch.finish(false)
latch.wait { results.append("late:\\($0)") }
precondition(results == ["first:true", "second:true", "late:true"])
let interrupted = IntroLatch()
interrupted.wait { precondition(!$0) }
interrupted.finish(false)
interrupted.finish(true)
interrupted.wait { precondition(!$0) }
`);
    const source = new URL('../../../node_modules/react-native-splash-motion/ios/IntroLatch.swift', import.meta.url).pathname;
    const compile = spawnSync('swiftc', [source, main, '-o', binary], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native lifecycle preserves intro playback on recreation and marker configuration', () => {
  const root = new URL('../../../node_modules/react-native-splash-motion/', import.meta.url);
  const android = readFileSync(new URL('android/src/main/java/com/margelo/nitro/splashmotion/SplashMotionController.kt', root), 'utf8');
  const install = android.slice(android.indexOf('  fun install('), android.indexOf('  private fun attachOverlay('));
  assert.match(install, /setOnExitAnimationListener/);
  assert.match(install, /setKeepOnScreenCondition/);
  assert.match(install, /if \(installed\)/);
  assert.ok(install.indexOf('setOnExitAnimationListener') < install.indexOf('if (installed)'), 'each Activity must register the exit listener before recreation returns');
  assert.ok(install.indexOf('setKeepOnScreenCondition') < install.indexOf('if (installed)'), 'each Activity must retain the splash until the overlay is ready');
  const ios = readFileSync(new URL('ios/LottieSplashPlayer.swift', root), 'utf8');
  const marker = ios.slice(ios.indexOf('if let marker = config.loopMarker'), ios.indexOf('  func remainingLoopTime()', ios.indexOf('if let marker = config.loopMarker')));
  assert.match(marker, /loopMode: \.playOnce/, 'non-looping marker plays once');
  assert.match(marker, /onIntroFinished\(finished\)/, 'marker reports actual completion');
  assert.match(marker, /loopMode: \.loop/, 'looping marker retains its loop behavior');
});


test('the Android system splash releases when missing configuration terminates playback', () => {
  const source = new URL('../../../node_modules/react-native-splash-motion/android/src/main/java/com/margelo/nitro/splashmotion/SplashMotionController.kt', import.meta.url);
  const android = readFileSync(source, 'utf8');
  assert.match(android, /if \(config == null\) \{[^}]*terminated = true[^}]*return/);
  assert.match(android, /setKeepOnScreenCondition \{ !terminated && !overlayReady \}/);
});

test('native splash watchdog releases the recovery screen within fifteen seconds', () => {
  const packageRoot = new URL('../../../node_modules/react-native-splash-motion/', import.meta.url);
  const android = readFileSync(
    new URL('android/src/main/java/com/margelo/nitro/splashmotion/SplashMotionController.kt', packageRoot),
    'utf8'
  );
  const ios = readFileSync(new URL('ios/SplashMotionController.swift', packageRoot), 'utf8');
  assert.match(android, /private const val WATCHDOG_MS = 15_000L/);
  assert.match(android, /main\.postDelayed\(\{ if \(!terminated\) abort\(\) \}, WATCHDOG_MS\)/);
  assert.match(android, /private fun abort\(\) \{[\s\S]*?finishDismiss\(\)/);
  assert.match(android, /private fun finishDismiss\(\) \{[\s\S]*?visible = false/);
  assert.match(
    ios,
    /private static let watchdogSeconds: TimeInterval = 15\s*$/m
  );
  assert.match(ios, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ Self\.watchdogSeconds\) \{ \[weak self\] in[\s\S]*?self\.finishDismiss\(\)/);
  assert.match(ios, /private func finishDismiss\(\)[\s\S]*?setVisible\(false\)/);
});
