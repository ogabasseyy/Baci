import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

interface SuccessIconProps {
  size?: number;
  color?: string;
}

export const SuccessIcon = ({
  size = 80,
  color = '#10B981',
}: SuccessIconProps) => {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg viewBox="0 0 100 100" width="100%" height="100%">
        {/* Outer subtle background circle */}
        <Circle
          cx="50"
          cy="50"
          r="46"
          stroke={color}
          strokeWidth="8"
          strokeOpacity="0.15"
          fill="transparent"
        />
        <Circle
          cx="50"
          cy="50"
          r="46"
          stroke={color}
          strokeWidth="8"
          fill="transparent"
          strokeLinecap="round"
          rotation="-90"
          origin="50, 50"
        />
        <Path
          d="M 30 50 L 45 65 L 70 35"
          stroke={color}
          strokeWidth="8"
          fill="transparent"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
