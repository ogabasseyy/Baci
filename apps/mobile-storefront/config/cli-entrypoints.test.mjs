import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
for (const name of ['start', 'android', 'ios', 'web', 'android:metro']) {
  test(`${name} loads the actual Expo config with its launcher Node options`, () => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      CI: 'false',
      EAS_BUILD: 'false',
    };
    const options = scripts[name].match(/^NODE_OPTIONS='([^']*)'/)?.[1];
    if (options) env.NODE_OPTIONS = options;
    else delete env.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "const {getConfig}=require('@expo/config');const {exp}=getConfig(process.cwd());if(exp.name!=='Ogabassey')throw Error('Wrong config');console.log('CONFIG_READY');",
      ],
      { cwd: appRoot, env, encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CONFIG_READY/);
  });
}
