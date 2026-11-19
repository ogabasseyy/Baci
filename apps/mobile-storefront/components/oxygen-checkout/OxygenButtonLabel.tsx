import { Animated, Text, View } from 'react-native';
import { useOxygenOtpPendingMotion } from './use-oxygen-otp-pending-motion';

export function OxygenButtonLabel({
  title,
  color,
  loading = false,
}: {
  title: string;
  color: string;
  loading?: boolean;
}) {
  const rotation = useOxygenOtpPendingMotion(loading);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      {loading ? (
        <Animated.View
          accessible={false}
          style={{
            pointerEvents: 'none',
            width: 18,
            height: 18,
            borderWidth: 2,
            borderRadius: 9,
            borderColor: color,
            borderRightColor: 'transparent',
            transform: [{ rotate: rotation }],
          }}
        />
      ) : null}
      <Text
        style={{
          color,
          fontSize: 16,
          fontWeight: '600',
          textAlign: 'center',
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
