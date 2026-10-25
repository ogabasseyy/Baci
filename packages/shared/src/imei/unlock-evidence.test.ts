import { describe, expect, it } from 'vitest';
import {
  canAssessImeiNetworkUnlock,
  getImeiBlacklistState,
} from './unlock-evidence';

describe('network unlock evidence', () => {
  it.each([
    'Blacklisted',
    'Clean / Reported Lost',
    'Not clean',
    'Not clear',
    'Unknown',
    'Unavailable',
    '',
  ])('does not offer an assessment for %s', (blacklistStatus) => {
    expect(
      canAssessImeiNetworkUnlock({ blacklistStatus, simLock: 'Locked' })
    ).toBe(false);
  });
  it('requires explicit clean blacklist evidence and a locked SIM', () => {
    expect(
      canAssessImeiNetworkUnlock({
        blacklistStatus: 'Not Blacklisted',
        simLock: 'Locked',
      })
    ).toBe(true);
    expect(
      canAssessImeiNetworkUnlock({
        blacklistStatus: 'Clean',
        simLock: 'Unknown',
      })
    ).toBe(false);
    expect(
      canAssessImeiNetworkUnlock({
        blacklistStatus: 'Clean',
        simLock: 'Unlocked',
      })
    ).toBe(false);
    expect(getImeiBlacklistState('Not clean')).not.toBe('clean');
  });
});

it('does not treat an unspecified Not Reported status as clean blacklist evidence', () => {
  expect(getImeiBlacklistState('Not Reported')).toBe('unknown');
  expect(
    canAssessImeiNetworkUnlock({
      blacklistStatus: 'Not Reported',
      simLock: 'Locked',
    })
  ).toBe(false);
});
it.each([
  'Not Reported Lost or Stolen',
  'Not reported as lost/stolen',
  'Not reported on the GSMA blacklist',
])('accepts explicit unreported blacklist/lost-device evidence: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('clean');
});
it('retains a reported risk beside explicit unreported evidence', () => {
  expect(
    getImeiBlacklistState('Not Reported Lost or Stolen / Reported Lost')
  ).toBe('risk');
});
it.each([
  'Not SIM Locked',
  'Not Network Locked',
  'Not Carrier Locked',
  'Not SIM-Locked',
  'SIM Locked: No',
  'Possibly Locked',
])('does not offer unlock assessment for negated or ambiguous SIM status: %s', (simLock) => {
  expect(
    canAssessImeiNetworkUnlock({ blacklistStatus: 'Clean', simLock })
  ).toBe(false);
});
it.each([
  'Locked',
  'SIM Locked',
  'Network Locked',
  'Carrier Locked',
])('preserves explicit locked verdicts: %s', (simLock) => {
  expect(
    canAssessImeiNetworkUnlock({ blacklistStatus: 'Clean', simLock })
  ).toBe(true);
});

it.each([
  'Maybe Clean',
  'Not actually Clean',
  'No clean result',
  'Clean? Unverified',
])('requires an explicit affirmative blacklist verdict, not just the word clean: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('unknown');
});
it.each([
  'Clean',
  'Clear',
  'Not Blacklisted / Clean',
  'Clean ✅',
])('preserves complete affirmative blacklist verdicts: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('clean');
});

it.each([
  'Clean?',
  'Not Blacklisted?',
  'Clean ❌',
  'Not reported as lost/stolen?',
])('never strips ambiguous or negative verdict markers: %s', (blacklistStatus) => {
  expect(getImeiBlacklistState(blacklistStatus)).toBe('unknown');
  expect(
    canAssessImeiNetworkUnlock({ blacklistStatus, simLock: 'Locked' })
  ).toBe(false);
});
