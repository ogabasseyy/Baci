const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const resolveMobileReact = require('./resolve-mobile-react');

for (const app of ['mobile-admin', 'mobile-storefront']) {
  for (const platform of ['ios', 'android', 'web']) {
    test(`${app} resolves React and its JSX runtime from the app on ${platform}`, () => {
      const projectRoot = path.resolve(__dirname, app);
      const context = {
        originModulePath: require.resolve('react-native'),
        unstable_conditionNames: ['react-native'],
        resolveRequest(next, name, target) {
          assert.equal(target, platform);
          assert.deepEqual(next.unstable_conditionNames, ['react-native']);
          return {
            type: 'sourceFile',
            filePath: require.resolve(name, {
              paths: [path.dirname(next.originModulePath)],
            }),
          };
        },
      };
      for (const name of [
        'react',
        'react/jsx-runtime',
        'react/compiler-runtime',
        'react-dom/client',
      ]) {
        assert.equal(
          resolveMobileReact(context, name, platform, projectRoot).filePath,
          require.resolve(name, { paths: [projectRoot] })
        );
      }
      assert.equal(context.originModulePath, require.resolve('react-native'));
    });
  }
}
test('leaves other dependencies to their own resolution graph', () => {
  const context = {
    resolveRequest() {
      throw new Error('must not resolve unrelated modules');
    },
  };
  assert.equal(
    resolveMobileReact(context, 'some-package', 'android', __dirname),
    null
  );
});
