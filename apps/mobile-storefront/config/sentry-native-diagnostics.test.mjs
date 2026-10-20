import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { configureAppDelegate } = require('./withSentryNativeDiagnostics.js');
const { createExpoPlugins } = require('./expo-plugins.js');
const withDiagnostics = require('./withSentryNativeDiagnostics.js');
const { modifyAppDelegate } = require(
  join(
    dirname(require.resolve('@sentry/react-native/package.json')),
    'plugin/build/withSentryIOS.js'
  )
);
const original = `import Expo
import RNSentry
class AppDelegate {
  func application() -> Bool {
    RNSentrySDK.start()
    return true
  }
}
`;

test('native startup passes the diagnostics callback to the real Sentry initializer', () => {
  const output = configureAppDelegate(original);
  assert.match(
    output,
    /RNSentrySDK.start\(configureOptions: configureBaciSentryDiagnostics\)/
  );
  assert.match(output, /^import Sentry$/m);
  const policy = readFileSync(
    new URL('./sentry-native-diagnostics.swift', import.meta.url),
    'utf8'
  )
    .replace(/^import Sentry\s*/, '')
    .trim();
  assert.ok(output.includes(policy));
  assert.equal(configureAppDelegate(output), output);
});

test('an unrecognized or duplicated Sentry initializer fails closed', () => {
  assert.throws(() => configureAppDelegate('import Expo\n'), /exactly one/);
  assert.throws(
    () => configureAppDelegate(`${original}RNSentrySDK.start()`),
    /exactly one/
  );
});

test('the diagnostics mod runs after Sentry and only when native Sentry is configured', () => {
  const sentry = ['@sentry/react-native/expo', { useNativeInit: true }];
  const plugins = createExpoPlugins({ sentryPlugin: sentry });
  assert.equal(
    plugins[plugins.indexOf(sentry) - 1],
    './config/withSentryNativeDiagnostics.js'
  );
  assert.ok(
    !createExpoPlugins({ sentryPlugin: null }).includes(
      './config/withSentryNativeDiagnostics.js'
    )
  );
});

test('real Expo/Sentry mods compose on clean and incremental prebuilds', async () => {
  const sentry = ['@sentry/react-native/expo', { useNativeInit: true }];
  const plugins = createExpoPlugins({ sentryPlugin: sentry });
  const run = async (contents) => {
    let config = { name: 'DiagnosticsFixture', slug: 'diagnostics-fixture' };
    for (const plugin of plugins) {
      if (plugin === sentry) config = modifyAppDelegate(config);
      if (plugin === './config/withSentryNativeDiagnostics.js')
        config = withDiagnostics(config);
    }
    const result = await config.mods.ios.appDelegate({
      ...config,
      modRequest: {},
      modResults: {
        path: '/fixture/AppDelegate.swift',
        language: 'swift',
        contents,
      },
    });
    return result.modResults.contents;
  };
  const clean = await run(original.replace('    RNSentrySDK.start()\n', ''));
  assert.match(
    clean,
    /start\(configureOptions: configureBaciSentryDiagnostics\)/
  );
  assert.equal(await run(clean), clean);
});
