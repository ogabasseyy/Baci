import { Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenHostedSurfaceProps } from './OxygenHostedSurface';
import { OxygenHostedSurface } from './OxygenHostedSurface';

export function OxygenHostedModal(props: OxygenHostedSurfaceProps) {
  const colors = useOxygenColors();
  return (
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={props.onExit}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <OxygenHostedSurface {...props} />
      </SafeAreaView>
    </Modal>
  );
}
