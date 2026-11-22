import { type RefObject, useLayoutEffect } from 'react';
import { Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenHostedSurfaceProps } from './OxygenHostedSurface';
import { OxygenHostedSurface } from './OxygenHostedSurface';

export function OxygenHostedModal({
  handlesForeground,
  ...props
}: OxygenHostedSurfaceProps & { handlesForeground?: RefObject<boolean> }) {
  const colors = useOxygenColors();
  useLayoutEffect(() => {
    if (!handlesForeground) return;
    handlesForeground.current = true;
    return () => {
      handlesForeground.current = false;
    };
  }, [handlesForeground]);
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
