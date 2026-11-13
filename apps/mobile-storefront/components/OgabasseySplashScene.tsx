import LottieView from 'lottie-react-native';
import { StyleSheet } from 'react-native';

export function OgabasseySplashScene({ onFinish }: { onFinish: () => void }) {
  return (
    <LottieView
      source={require('@/assets/splash-scene/ogabassey-intro.json')}
      autoPlay
      loop={false}
      resizeMode="cover"
      onAnimationFinish={(cancelled) => {
        if (!cancelled) onFinish();
      }}
      style={StyleSheet.absoluteFill}
    />
  );
}
