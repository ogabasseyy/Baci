import { Text } from 'react-native';

export function PaidOrderChangeMessage({
  message,
  color,
}: {
  message: string;
  color: string;
}) {
  return (
    <Text accessibilityLiveRegion="polite" style={{ color }}>
      {message}
    </Text>
  );
}
