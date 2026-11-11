import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BREAK_GLASS_LABEL, DEFAULT_TIMEOUT_MINUTES, PILOT_LABEL, decideStage, parseTimeoutMinutes, sweepLookbackMs } from './stage-decision.mjs';

const clean = { state: 'clean', carried: false, reason: 'Codex is clean for the head commit' };
const none = { state: 'none', carried: false, reason: 'no Codex verdict yet' };

const input = (overrides = {}) => ({
  eventName: 'pull_request',
  mode: 'on',
  sameRepo: true,
  labels: [],
  draft: false,
  open: true,
  headSha: 'a'.repeat(40),
  liveHeadSha: 'a'.repeat(40),
  verdict: none,
  ageMinutes: 5,
  timeoutMinutes: 60,
  apiError: null,
  ...overrides,
});

const stageOf = (overrides) => decideStage(input(overrides));

describe('events and modes that never defer', () => {
  for (const eventName of ['push', 'merge_group', 'workflow_dispatch', 'schedule']) {
    it(`runs full CI for ${eventName}`, () => {
      const result = stageOf({ eventName });
      assert.equal(result.stage, 'full');
      assert.equal(result.code, 'not-pull-request');
    });
  }

  it('runs full CI for a pull request from a fork', () => {
    assert.equal(stageOf({ sameRepo: false }).code, 'fork');
    assert.equal(stageOf({ sameRepo: false }).stage, 'full');
  });

  for (const mode of [undefined, '', 'off', 'true', 'ON']) {
    it(`runs full CI when the switch is ${JSON.stringify(mode)}`, () => {
      const result = stageOf({ mode });
      assert.equal(result.stage, 'full');
      assert.equal(result.code, 'mode-off');
    });
  }

  it('pilot mode defers only pull requests that carry the pilot label', () => {
    assert.equal(stageOf({ mode: 'pilot' }).code, 'pilot-not-selected');
    assert.equal(stageOf({ mode: 'pilot' }).stage, 'full');
    assert.equal(stageOf({ mode: 'pilot', labels: [PILOT_LABEL] }).stage, 'quick');
  });
});

describe('review-first behaviour', () => {
  it('waits (quick only) while Codex has said nothing', () => {
    const result = stageOf({});
    assert.equal(result.stage, 'quick');
    assert.equal(result.code, 'waiting');
  });

  it('starts the full suite when Codex is clean for the head', () => {
    const result = stageOf({ verdict: clean });
    assert.equal(result.stage, 'full');
    assert.equal(result.code, 'codex-clean');
  });

  it('keeps waiting on Codex findings, even after the timeout', () => {
    const verdict = { state: 'findings', carried: false, reason: 'Codex reported findings' };
    assert.equal(stageOf({ verdict }).stage, 'quick');
    const late = stageOf({ verdict, ageMinutes: 600 });
    assert.equal(late.stage, 'quick');
    assert.equal(late.code, 'codex-findings');
  });

  it('keeps waiting while Codex is still running, until the timeout', () => {
    const verdict = { state: 'running', carried: false, reason: 'Codex is reviewing' };
    assert.equal(stageOf({ verdict }).stage, 'quick');
    assert.equal(stageOf({ verdict, ageMinutes: 61 }).code, 'timeout');
  });

  it('never starts on a superseded commit', () => {
    const result = stageOf({ verdict: clean, liveHeadSha: 'b'.repeat(40) });
    assert.equal(result.stage, 'quick');
    assert.equal(result.code, 'superseded');
  });

  it('never starts for a closed or merged pull request', () => {
    assert.equal(stageOf({ verdict: clean, open: false }).code, 'closed');
  });

  it('labels a carried verdict so the log shows the proof', () => {
    const result = stageOf({ verdict: { ...clean, carried: true, reason: 'verdict for 1111111 carried: same net diff' } });
    assert.equal(result.stage, 'full');
    assert.match(result.reason, /carried/);
  });
});

describe('break-glass and timeout', () => {
  it('ci-now starts the full suite immediately', () => {
    const result = stageOf({ labels: [BREAK_GLASS_LABEL] });
    assert.equal(result.stage, 'full');
    assert.equal(result.code, 'break-glass');
  });

  it('ci-now wins over findings', () => {
    const verdict = { state: 'findings', carried: false, reason: 'Codex reported findings' };
    assert.equal(stageOf({ labels: [BREAK_GLASS_LABEL], verdict }).stage, 'full');
  });

  it('ci-now does not start a superseded commit', () => {
    assert.equal(stageOf({ labels: [BREAK_GLASS_LABEL], liveHeadSha: 'b'.repeat(40) }).stage, 'quick');
  });

  it('starts after the timeout when Codex said nothing', () => {
    assert.equal(stageOf({ ageMinutes: 59 }).stage, 'quick');
    const result = stageOf({ ageMinutes: 60 });
    assert.equal(result.stage, 'full');
    assert.equal(result.code, 'timeout');
    assert.equal(result.warn, true);
  });

  it('does not time out draft pull requests', () => {
    assert.equal(stageOf({ draft: true, ageMinutes: 600 }).stage, 'quick');
  });

  it('still honours a clean verdict on a draft', () => {
    assert.equal(stageOf({ draft: true, verdict: clean }).stage, 'full');
  });
});

describe('failing closed', () => {
  it('stays quick and warns when the verdict could not be read', () => {
    const result = stageOf({ apiError: 'HTTP 502', verdict: null });
    assert.equal(result.stage, 'quick');
    assert.equal(result.code, 'api-error');
    assert.equal(result.warn, true);
  });

  it('still lets the timeout and ci-now work when the API is down', () => {
    assert.equal(stageOf({ apiError: 'HTTP 502', verdict: null, ageMinutes: 90 }).code, 'timeout');
    assert.equal(stageOf({ apiError: 'HTTP 502', verdict: null, labels: [BREAK_GLASS_LABEL] }).code, 'break-glass');
  });

  it('warns when Codex wrote something this code does not understand', () => {
    const result = stageOf({ verdict: { ...none, unrecognized: ['comment 1: codex-review-state:v2 is not understood'] } });
    assert.equal(result.stage, 'quick');
    assert.equal(result.warn, true);
    assert.match(result.reason, /not understood/);
  });
});

describe('bugfix: an unreadable pull request in pilot mode must not look like "not selected"', () => {
  it('stays quick with an API warning when the labels are unknown (never the full CI)', () => {
    const result = stageOf({ mode: 'pilot', labels: undefined, apiError: 'HTTP 502', verdict: null });
    assert.equal(result.stage, 'quick');
    assert.equal(result.code, 'api-error');
    assert.equal(result.warn, true);
  });

  it('still lets the timeout start the full CI when the labels are unknown', () => {
    assert.equal(stageOf({ mode: 'pilot', labels: undefined, apiError: 'HTTP 502', verdict: null, ageMinutes: 90 }).code, 'timeout');
  });

  it('only concludes "not selected" when the labels were actually read', () => {
    assert.equal(stageOf({ mode: 'pilot', labels: [] }).code, 'pilot-not-selected');
  });
});

describe('timeout settings', () => {
  it('reads minutes and falls back to the default for nonsense', () => {
    assert.equal(parseTimeoutMinutes('45'), 45);
    for (const value of [undefined, '', 'soon', '0', '-5', '1.5x']) assert.equal(parseTimeoutMinutes(value), DEFAULT_TIMEOUT_MINUTES, String(value));
  });

  it('caps absurdly long timeouts so the sweep can always reach them', () => {
    assert.equal(parseTimeoutMinutes('99999'), 1440);
  });

  it('looks back at least six hours and always past the timeout plus the sweep margin', () => {
    const minutes = (ms) => ms / 60000;
    assert.equal(minutes(sweepLookbackMs(60)), 360);
    assert.ok(minutes(sweepLookbackMs(720)) >= 720 + 150);
    assert.ok(minutes(sweepLookbackMs(1440)) >= 1440 + 150);
  });
});
