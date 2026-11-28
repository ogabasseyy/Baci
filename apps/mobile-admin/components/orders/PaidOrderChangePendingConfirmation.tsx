import { Text } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderChangeAction } from './PaidOrderChangeAction';

interface Props {
  colors: ThemeColors;
  disabled: boolean;
  onCheck: () => void;
  onRetry: () => void;
}

export function PaidOrderChangePendingConfirmation({
  colors,
  disabled,
  onCheck,
  onRetry,
}: Props) {
  return (
    <>
      <Text style={{ color: colors.text }}>
        A confirmation needs to be checked.
      </Text>
      <PaidOrderChangeAction
        label="Check confirmation status"
        onPress={onCheck}
        disabled={disabled}
      />
      <PaidOrderChangeAction
        label="Retry the same confirmation"
        onPress={onRetry}
        disabled={disabled}
      />
    </>
  );
}
