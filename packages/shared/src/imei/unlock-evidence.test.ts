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

it.each([
  'Not on blacklist',
  'Not on the GSMA blacklist',
])('recognizes explicit absence: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('clean');
});
it('does not infer a clean verdict from an ambiguous lookup or question', () => {
  expect(getImeiBlacklistState('No blacklist record found')).toBe('unknown');
  expect(getImeiBlacklistState('Not on blacklist?')).toBe('unknown');
  expect(getImeiBlacklistState('Not on blacklist / Reported lost')).toBe(
    'risk'
  );
});

it.each([
  'Not blocked',
  'Unblocked',
  'Not stolen',
  'No blacklist record found?',
])('does not report ambiguous or negated evidence as a risk: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('unknown');
});
it('preserves explicit risk alongside an unknown result', () => {
  expect(getImeiBlacklistState('Unknown / Reported stolen')).toBe('risk');
});

it.each([
  'Blacklist status unknown',
  'Blacklist unavailable',
  'Unable to check blacklist',
  'Error checking blacklist',
  'Pending blacklist check',
])('does not treat unavailable check as risk: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('unknown');
});

it.each([
  'Unable to check lost/stolen status',
  'Lost / stolen status unavailable',
])('keeps an unavailable lost/stolen report unknown: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('unknown');
});

it.each([
  'Not lost/stolen',
  'No lost or stolen',
  'Unable to check lost and stolen status',
  'Lost and stolen status unavailable',
])('does not assert risk for a negated or unavailable compound: %s', (value) => {
  expect(getImeiBlacklistState(value)).toBe('unknown');
});
it('recognizes explicitly unreported lost and stolen evidence', () => {
  expect(getImeiBlacklistState('Not reported as lost and stolen')).toBe(
    'clean'
  );
});
