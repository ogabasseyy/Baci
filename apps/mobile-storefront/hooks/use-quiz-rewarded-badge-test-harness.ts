import { jest } from '@jest/globals';

// Shared mock handles and builders for the useQuizRewardedBadge suites
// (core + lifecycle + ownership). Pure module on purpose: jest.mock
// hoisting is per-file, so each suite registers its own mocks referencing
// these handles. Each test file gets a fresh module registry, so this
// state is never shared across suites.

export const mockUnlockBadge = jest.fn();
export const mockUseQuizMobileAds = jest.fn();
export const mockSetQuizRewardedFlowActive = jest.fn();
export const mockAuthCustomer: { date_of_birth: string | null } = {
  date_of_birth: null,
};
export const mockPlacementState = { enabled: true };

export type GateProps = {
  eventId: string;
  eventTitle: string;
  remainingSeconds: number;
  status: 'active' | 'scheduled';
  userId: string;
};
