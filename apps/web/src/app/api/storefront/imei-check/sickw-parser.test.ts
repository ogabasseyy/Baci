import { describe, expect, it } from 'vitest';
import { parseSickwResponse } from './sickw-parser';

describe('parseSickwResponse', () => {
  it('parses html line breaks into structured check fields', () => {
    const result = parseSickwResponse(
      [
        'Model Name: iPhone 15',
        'Model Number: A3090',
        'Blacklist Status: Clean',
        'Find My iPhone: OFF',
      ].join('<br>')
    );

    expect(result).toMatchObject({
      device: 'iPhone 15',
      modelNumber: 'A3090',
      blacklistStatus: 'Clean',
      icloudLock: 'OFF',
      deviceType: 'apple',
      verdictType: 'safe',
    });
  });

  it('downgrades stolen blacklist results to danger', () => {
    const result = parseSickwResponse(
      'Model Name: Samsung S24<br>Blacklist: Reported stolen'
    );

    expect(result.status).toBe('Blacklisted');
    expect(result.verdictType).toBe('danger');
    expect(result.deviceType).toBe('android');
    expect(result.score).toBeLessThan(100);
  });

  it('normalizes object payloads from beta provider responses', () => {
    const result = parseSickwResponse({
      'Model Name': 'Samsung S24',
      Blacklist: 'Clean',
      Extra: 'Ignored',
    });

    expect(result).toMatchObject({
      blacklistStatus: 'Clean',
      device: 'Samsung S24',
      deviceType: 'android',
      verdictType: 'safe',
    });
  });

  it('sanitizes nested and encoded html from provider fields', () => {
    const result = parseSickwResponse(
      'Model Name: &lt;b&gt;iPhone 15&lt;/b&gt;<br>Blacklist Status: <div><p>Clean</p></div>'
    );

    expect(result.device).toBe('iPhone 15');
    expect(result.blacklistStatus).toBe('Clean');
  });

  it('returns incomplete caution data for empty or malformed strings', () => {
    expect(parseSickwResponse('')).toMatchObject({
      status: 'Unknown',
      verdictType: 'caution',
      score: 90,
    });

    expect(
      parseSickwResponse('not a provider key value response')
    ).toMatchObject({
      status: 'Unknown',
      verdictType: 'caution',
    });
  });

  it('handles nullish runtime inputs without throwing', () => {
    expect(parseSickwResponse(null as never)).toMatchObject({
      status: 'Unknown',
      verdictType: 'caution',
    });
    expect(parseSickwResponse(undefined as never)).toMatchObject({
      status: 'Unknown',
      verdictType: 'caution',
    });
  });

  it('keeps unknown blacklist values from forcing danger verdicts', () => {
    const result = parseSickwResponse(
      'Model Name: Pixel 8<br>Blacklist Status:   Not found   '
    );

    expect(result.status).toBe('Unknown');
    expect(result.verdictType).toBe('caution');
    expect(result.deviceType).toBe('android');
  });

  it('does not treat unlocked or not-blacklisted values as risk tokens', () => {
    const result = parseSickwResponse(
      [
        'Model Name: iPhone 15',
        'Blacklist Status: Not Blacklisted',
        'Find My iPhone: Unlocked',
        'iCloud Status: Not Lost',
        'SIM Lock: Unlocked',
      ].join('<br>')
    );

    expect(result.status).toBe('Clean');
    expect(result.verdictType).toBe('safe');
    expect(result.score).toBe(100);
  });

  it('parses clean-lost iCloud status aliases as paid iCloud risk signals', () => {
    const result = parseSickwResponse(
      [
        'Model Name: iPhone 15 Pro',
        'Clean/Lost: Lost',
        'Find My iPhone: OFF',
      ].join('<br>')
    );

    expect(result.icloud).toBe('Lost');
    expect(result.icloudLock).toBe('OFF');
    expect(result.status).toBe('Blacklisted');
    expect(result.verdictType).toBe('danger');
    expect(result.score).toBe(80);
  });

  it('surfaces Xiaomi lock status as a caution verdict', () => {
    const result = parseSickwResponse(
      'Model Name: Xiaomi 14<br>MI Lock Status: Locked<br>MI Lost Status: Clean'
    );

    expect(result.miLockStatus).toBe('Locked');
    expect(result.miLostStatus).toBe('Clean');
    expect(result.status).toBe('Unknown');
    expect(result.verdictType).toBe('caution');
    expect(result.verdict).toContain('Xiaomi account lock');
  });

  it('surfaces Xiaomi lost status as a danger verdict', () => {
    const result = parseSickwResponse({
      'Model Name': 'Redmi Note 13',
      'Mi Account Status': 'Unlocked',
      'Lost Mode': 'Lost',
    });

    expect(result.miLockStatus).toBe('Unlocked');
    expect(result.miLostStatus).toBe('Lost');
    expect(result.status).toBe('Blacklisted');
    expect(result.verdictType).toBe('danger');
  });

  it('does not treat generic lost fields as Xiaomi lost status for Apple devices', () => {
    const result = parseSickwResponse({
      'Model Name': 'iPhone 15',
      'Lost Mode': 'Lost',
      'Blacklist Status': 'Clean',
    });

    expect(result.miLostStatus).toBeUndefined();
    expect(result.status).toBe('Clean');
    expect(result.verdictType).toBe('safe');
    expect(result.verdict).not.toContain('Xiaomi lost status');
  });

  it('treats active mdm status as a caution verdict', () => {
    const result = parseSickwResponse(
      'Model Name: iPhone 14 Pro<br>MDM Status: ON'
    );

    expect(result.device).toBe('iPhone 14 Pro');
    expect(result.mdmStatus).toBe('ON');
    expect(result.verdictType).toBe('caution');
    expect(result.verdict).toContain('Mobile Device Management');
    expect(result.score).toBe(70);
  });

  it('does not treat inactive mdm status as a risk token', () => {
    const result = parseSickwResponse(
      'Model Name: iPhone 14 Pro<br>Blacklist Status: Clean<br>MDM Status: Not locked'
    );

    expect(result.mdmStatus).toBe('Not locked');
    expect(result.verdictType).toBe('safe');
    expect(result.score).toBe(100);
  });

  it('surfaces an active Knox Guard status as a caution verdict', () => {
    const result = parseSickwResponse(
      'Model Name: Galaxy S24<br>Knox Guard: Locked'
    );

    expect(result.knoxGuardStatus).toBe('Locked');
    expect(result.verdictType).toBe('caution');
    expect(result.verdict).toContain('Samsung Knox Guard');
    expect(result.score).toBe(70);
  });

  it('resolves Knox Guard status from its provider field aliases', () => {
    const result = parseSickwResponse({
      'Model Name': 'Galaxy S24',
      knoxguard: 'Active',
    });

    expect(result.knoxGuardStatus).toBe('Active');
    expect(result.verdictType).toBe('caution');
    expect(result.verdict).toContain('Samsung Knox Guard');
  });

  it('does not treat a cleared Knox Guard status as a risk token', () => {
    const result = parseSickwResponse(
      'Model Name: Galaxy S24<br>Blacklist Status: Clean<br>Knox Guard Status: Not active'
    );

    expect(result.knoxGuardStatus).toBe('Not active');
    expect(result.verdictType).toBe('safe');
    expect(result.score).toBe(100);
  });

  it('ranks a danger blacklist ahead of an active Knox Guard caution', () => {
    const result = parseSickwResponse(
      'Model Name: Galaxy S24<br>Blacklist Status: Blacklisted<br>Knox Guard: Locked'
    );

    expect(result.knoxGuardStatus).toBe('Locked');
    expect(result.verdictType).toBe('danger');
    expect(result.verdict).not.toContain('Samsung Knox Guard');
  });
});

it('does not present a model-only report as safe', () => {
  const result = parseSickwResponse({ model: 'iPhone 15' });
  expect(result.status).toBe('Unknown');
  expect(result.verdictType).toBe('caution');
});

it.each([
  'Not blocked',
  'Unblocked',
  'Not stolen',
  'No blacklist record found?',
])('does not assert blacklist risk for %s', (blacklist) => {
  const result = parseSickwResponse({
    model: 'iPhone',
    'blacklist status': blacklist,
  });
  expect(result.status).toBe('Unknown');
  expect(result.verdictType).toBe('caution');
});
it('retains danger when a partial report also says reported stolen', () => {
  const result = parseSickwResponse({
    model: 'iPhone',
    'blacklist status': 'Unknown / Reported stolen',
  });
  expect(result.status).toBe('Blacklisted');
  expect(result.verdictType).toBe('danger');
});
