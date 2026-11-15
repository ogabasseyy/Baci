import type { ImeiDeviceCategory } from '@baci/shared/imei';
import { View } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { ImeiDeviceTabs } from './ImeiDeviceTabs';
import type { ImeiCheckerColors } from './imei-check.types';
import HeroCard from './imei-check-hero-card';

/** The top of the checker form: the hero card and the device tabs. */
export function ImeiCheckTop({
  colors,
  selected,
  onSelect,
}: {
  colors: ImeiCheckerColors;
  selected: ImeiDeviceCategory;
  onSelect: (device: ImeiDeviceCategory) => void;
}) {
  return (
    <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.sm }}>
      <HeroCard colors={colors} />
      <ImeiDeviceTabs colors={colors} selected={selected} onSelect={onSelect} />
    </View>
  );
}
