import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { Pressable, Text } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { formatServicePrice } from './format-service-price';
import { useImeiRuntimeAvailability } from './use-imei-runtime-availability';
export function ImeiBlacklistCheckAction({
  isChecking,
  onCheck,
}: {
  isChecking: boolean;
  onCheck: () => void;
}) {
  const availability = useImeiRuntimeAvailability('smartphone');
  if (
    availability.loading ||
    availability.failed ||
    !availability.availableTierKeys?.includes('blacklist')
  )
    return null;
  const label = `Check blacklist status · ${formatServicePrice(IMEI_SERVICE_TIERS.blacklist.price)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isChecking, busy: isChecking }}
      disabled={isChecking}
      onPress={onCheck}
      style={{
        minHeight: 44,
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        backgroundColor: BRAND.primary,
        opacity: isChecking ? 0.6 : 1,
      }}
    >
      <Text
        style={{
          color: BRAND.onPrimary,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {isChecking ? 'Checking blacklist…' : label}
      </Text>
    </Pressable>
  );
}
