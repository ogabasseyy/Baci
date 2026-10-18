const { withAppDelegate } = require('@expo/config-plugins');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const BEGIN = '// @generated begin baci-sentry-diagnostics';
const END = '// @generated end baci-sentry-diagnostics';
const START = 'RNSentrySDK.start()';
const CONFIGURED =
  'RNSentrySDK.start(configureOptions: configureBaciSentryDiagnostics)';

function configureAppDelegate(contents) {
  const previous = new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`, 'g');
  let result = contents.replace(previous, '').replaceAll(CONFIGURED, START);
  if (result.split(START).length !== 2) {
    throw new Error(
      'Expected exactly one native Sentry initializer before adding diagnostics.'
    );
  }
  result = result.replace(START, CONFIGURED);
  if (!/^import Sentry$/m.test(result)) result = `import Sentry\n${result}`;
  const policy = readFileSync(
    join(__dirname, 'sentry-native-diagnostics.swift'),
    'utf8'
  )
    .replace(/^import Sentry\s*/, '')
    .trim();
  // Sentry checks this exact token before inserting startup on incremental
  // prebuild. Keep it inside our replaceable generated block, not a second call.
  const marker =
    '// RNSentrySDK.start() is configured above; retained for Sentry prebuild detection.';
  return `${result.trimEnd()}\n\n${BEGIN}\n${marker}\n${policy}\n${END}\n`;
}

module.exports = (config) =>
  withAppDelegate(config, (inner) => {
    if (inner.modResults.language !== 'swift') {
      throw new Error(
        'Native Sentry diagnostics require the storefront Swift AppDelegate.'
      );
    }
    inner.modResults.contents = configureAppDelegate(inner.modResults.contents);
    return inner;
  });
module.exports.configureAppDelegate = configureAppDelegate;
