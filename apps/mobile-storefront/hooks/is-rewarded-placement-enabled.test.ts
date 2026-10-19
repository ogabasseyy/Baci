import { describe, expect, it, jest } from '@jest/globals';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { isRewardedPlacementEnabled } from './is-rewarded-placement-enabled';

jest.mock('@/config/mobile-ad-placements', () => ({
  getMobileAdUnitId: jest.fn(),
}));

const mockGetMobileAdUnitId = jest.mocked(getMobileAdUnitId);

describe('isRewardedPlacementEnabled', () => {
  it('reflects the REWARDED placement gate', () => {
    // Arrange & Act & Assert
    mockGetMobileAdUnitId.mockReturnValue({
      enabled: true,
      format: 'rewarded',
      unitId: 'test-rewarded-unit',
    });
    expect(isRewardedPlacementEnabled()).toBe(true);
    expect(mockGetMobileAdUnitId).toHaveBeenCalledWith('REWARDED');

    mockGetMobileAdUnitId.mockReturnValue({ enabled: false });
    expect(isRewardedPlacementEnabled()).toBe(false);
  });

  it('fails closed when the registry rejects the placement', () => {
    // Arrange & Act & Assert: an unconfigured production unit id throws;
    // the offer must stay withheld, not crash the room.
    mockGetMobileAdUnitId.mockImplementation(() => {
      throw new Error('must be a non-sample unit ID');
    });
    expect(isRewardedPlacementEnabled()).toBe(false);
  });
});
