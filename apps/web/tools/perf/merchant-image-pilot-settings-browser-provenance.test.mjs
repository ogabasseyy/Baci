import { describe, expect, it } from 'vitest';
import { verifyBrowserProvenance } from './merchant-image-pilot-settings-browser-provenance.mjs';

describe('merchant-image-pilot-settings browser provenance', () => {
  const pages = [
    {
      _meta: { runId: 'run-navigation-1' },
      startedDateTime: '2026-10-04T00:10:00.000Z',
    },
  ];
  const valid = JSON.stringify({
    browserName: 'chrome',
    event: 'browser-launch',
    executableVersion: '154.0.0.0',
    launchedAt: '2026-10-04T00:09:30.000Z',
    runId: 'run-navigation-1',
    tool: 'browsertime',
  });

  it('binds a runner launch to the measured navigation', () => {
    expect(verifyBrowserProvenance(valid, pages, '154', 'launch.json')).toEqual(
      {
        browserName: 'chrome',
        executableVersion: '154.0.0.0',
        ok: true,
        summary: 'browsertime@154.0.0.0',
      }
    );
  });

  it('refuses headless-shell launches and missing product records', () => {
    // Same dotted build, different product: the version check alone
    // would certify shell evidence, including runs whose HAR UA is
    // emulated past the har.browser substring check.
    const shell = JSON.stringify({
      ...JSON.parse(valid),
      browserName: 'chrome-headless-shell',
    });
    expect(verifyBrowserProvenance(shell, pages, '154').error).toMatch(
      /not full Chrome/
    );
    const { browserName: _dropped, ...nameless } = JSON.parse(valid);
    expect(
      verifyBrowserProvenance(JSON.stringify(nameless), pages, '154').error
    ).toMatch(/records no browserName/);
  });

  it('refuses a launch with first navigation explicitly unverified', () => {
    // A markerless bind flags itself at bind time; the gate must refuse
    // it, not certify cold on unattested evidence.
    const flagged = JSON.stringify({
      ...JSON.parse(valid),
      firstNavigationUnverified: true,
    });
    expect(
      verifyBrowserProvenance(flagged, pages, '154', 'launch.json')
    ).toEqual({
      error:
        'browser-provenance first navigation is explicitly unverified (markerless log cannot prove a cold cache); re-capture with a navigation-marked verbose log',
      ok: false,
    });
  });

  it('refuses unreadable, malformed, and misshapen launches', () => {
    expect(
      verifyBrowserProvenance(null, pages, '154', 'missing.json').error
    ).toMatch(/cannot read/);
    expect(verifyBrowserProvenance('{nope', pages, '154').error).toMatch(
      /not valid JSON/
    );
    for (const [label, patch] of [
      ['event', { event: 'run-start' }],
      ['tool', { tool: '' }],
      ['runId', { runId: '' }],
      ['version', { executableVersion: 154 }],
      ['launchedAt', { launchedAt: 'yesterday' }],
    ]) {
      const text = JSON.stringify({ ...JSON.parse(valid), ...patch });
      expect(verifyBrowserProvenance(text, pages, '154').error, label).toMatch(
        /must be a runner browser-launch record/
      );
    }
  });

  it('requires the launch to certify exactly this navigation', () => {
    expect(
      verifyBrowserProvenance(valid, [...pages, ...pages], '154').error
    ).toMatch(/exactly one HAR iteration/);
    expect(verifyBrowserProvenance(valid, [{}], '154').error).toMatch(
      /carries no _meta.runId/
    );
    const otherRun = JSON.stringify({
      ...JSON.parse(valid),
      runId: 'run-other',
    });
    expect(verifyBrowserProvenance(otherRun, pages, '154').error).toMatch(
      /runId does not match/
    );
    expect(
      verifyBrowserProvenance(
        valid,
        [{ _meta: { runId: 'run-navigation-1' } }],
        '154'
      ).error
    ).toMatch(/carry no startedDateTime/);
  });

  it('requires the launch inside the run window', () => {
    const postdated = JSON.stringify({
      ...JSON.parse(valid),
      launchedAt: '2026-10-04T00:11:00.000Z',
    });
    expect(verifyBrowserProvenance(postdated, pages, '154').error).toMatch(
      /postdates the measured run/
    );
    // Same ordering tolerance finish applies (max of the session
    // slack and the reset skew): a launch 1s after the HAR start
    // passes here exactly as finish certifies it.
    const skewed = JSON.stringify({
      ...JSON.parse(valid),
      launchedAt: '2026-10-04T00:10:01.000Z',
    });
    expect(verifyBrowserProvenance(skewed, pages, '154').ok).toBe(true);
    const stale = JSON.stringify({
      ...JSON.parse(valid),
      launchedAt: '2026-10-03T00:09:30.000Z',
    });
    expect(verifyBrowserProvenance(stale, pages, '154').error).toMatch(
      /launch is stale/
    );
  });

  it('requires the run-bound executable major', () => {
    const older = JSON.stringify({
      ...JSON.parse(valid),
      executableVersion: '153.0.0.0',
    });
    expect(verifyBrowserProvenance(older, pages, '154').error).toMatch(
      /does not match Chrome 154/
    );
    const malformed = JSON.stringify({
      ...JSON.parse(valid),
      executableVersion: 'debian-chromium',
    });
    expect(verifyBrowserProvenance(malformed, pages, '154').error).toMatch(
      /not a dotted browser build/
    );
  });
});
