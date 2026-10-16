import { describe, expect, it } from 'vitest';
import {
  resolvePreparedLaunch,
  SESSION_NAV_SLACK_MS,
} from './merchant-image-pilot-runner-finish-log.mjs';

describe('merchant-image-pilot-runner-finish-log', () => {
  it('parses executableVersion, browserName, navigationCount, and sessionMs from prepared profile launch', () => {
    expect(SESSION_NAV_SLACK_MS).toBe(1000);
    const logText = [
      'Launching Chrome --user-data-dir=/tmp/prof-1 --headless',
      '[1702635762.891][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "154.0.0.0" } } }',
      '[browsertime] Navigating to http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot',
      'Launching Chrome --user-data-dir=/tmp/prof-other --headless',
      '[1702635800.000][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "153.0.0.0" } } }',
    ].join('\n');

    const result = resolvePreparedLaunch(logText, '/tmp/prof-1', 'chrome.log');
    expect(result).toEqual({
      browserName: 'chrome',
      executableVersion: '154.0.0.0',
      navigationCount: 1,
      sessionMs: 1702635762891,
    });
  });

  it('rejects missing launches, duplicate launches, multiple navigations, or missing capabilities', () => {
    expect(() =>
      resolvePreparedLaunch('no launch here', '/tmp/prof-1', 'chrome.log')
    ).toThrow(/shows no launch with the prepared profile dir/);

    const duplicateLaunch = [
      'Launching --user-data-dir=/tmp/prof-1',
      'Launching --user-data-dir=/tmp/prof-1',
    ].join('\n');
    expect(() =>
      resolvePreparedLaunch(duplicateLaunch, '/tmp/prof-1', 'chrome.log')
    ).toThrow(/shows 2 launches/);

    const twoNavs = [
      'Launching --user-data-dir=/tmp/prof-1',
      'Navigating to http://a',
      'Navigating to http://b',
    ].join('\n');
    expect(() =>
      resolvePreparedLaunch(twoNavs, '/tmp/prof-1', 'chrome.log')
    ).toThrow(/shows 2 navigations/);

    expect(() =>
      resolvePreparedLaunch(
        'Launching --user-data-dir=/tmp/prof-1\nNavigating to http://a',
        '/tmp/prof-1',
        'chrome.log'
      )
    ).toThrow(/records no browserVersion/);
  });
});
