import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const routerRoot = require
  .resolve('expo-router/package.json')
  .replace(/package\.json$/, 'build/');

test('Expo Router prefetch preloads an inactive tab without changing focus', () => {
  const source = readFileSync(`${routerRoot}global-state/router.js`, 'utf8');
  assert.match(source, /function prefetchImpl\([\s\S]*?event: 'PRELOAD'/);
  const { TabRouter } = require(
    `${routerRoot}react-navigation/routers/TabRouter.js`
  );
  const router = TabRouter({});
  const state = {
    type: 'tab',
    key: 'tabs',
    index: 0,
    routeNames: ['index', 'orders'],
    routes: [{ key: 'index-1', name: 'index' }],
    history: [{ type: 'route', key: 'index-1' }],
  };
  const result = router.getStateForAction(
    state,
    { type: 'PRELOAD', payload: { name: 'orders' } },
    {
      routeNames: state.routeNames,
      routeParamList: {},
      routeGetIdList: {},
    }
  );
  assert.equal(result.state.index, 0);
  assert.equal(
    result.state.routes.find((route) => route.name === 'orders').isPreloaded,
    true
  );
  const tabView = readFileSync(
    `${routerRoot}react-navigation/bottom-tabs/views/BottomTabView.js`,
    'utf8'
  );
  assert.match(tabView, /children: descriptor\.render\(\)/);
});
