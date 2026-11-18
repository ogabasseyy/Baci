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
  // While availability loads, say so: a blank space reads as "not offered".
  const loading = availability.loading;
  if (
    !loading &&
    (availability.failed ||
      !availability.availableTierKeys?.includes('blacklist'))
  )
    return null;
  const busy = isChecking || loading;
  const label = loading
    ? 'Checking blacklist availability…'
    : `Check blacklist status · ${formatServicePrice(IMEI_SERVICE_TIERS.blacklist.price)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onCheck}
      style={{
        minHeight: 44,
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        backgroundColor: BRAND.primary,
        opacity: busy ? 0.6 : 1,
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
