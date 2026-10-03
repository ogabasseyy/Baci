import { type ReactNode, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export function SearchToolbarReveal({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(1);
  useEffect(() => {
    // withTiming defaults to the system reduced-motion preference.
    progress.value = withTiming(visible ? 1 : 0, {
      duration: 180,
    });
  }, [visible, progress]);
  const container = useAnimatedStyle(() =>
    height ? { height: height * progress.value } : {}
  );
  const content = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: -height * (1 - progress.value) }],
  }));
  return (
    <Animated.View
      testID="search-toolbar-reveal"
      style={[{ overflow: 'hidden' }, container]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View
        style={[
          height ? { position: 'absolute', left: 0, right: 0 } : undefined,
          content,
        ]}
      >
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
