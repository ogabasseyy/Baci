import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import { useEffect, useEffectEvent } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import type { CheckoutStep } from './CheckoutStepper';

interface UseCheckoutNavigationParams {
  isOrderInFlight: MutableRefObject<boolean>;
  isPrizeSimulation?: boolean;
  setStep: (step: CheckoutStep) => void;
  step: CheckoutStep;
}

export function useCheckoutNavigation({
  isOrderInFlight,
  isPrizeSimulation = false,
  setStep,
  step,
}: UseCheckoutNavigationParams) {
  const handleBack = () => {
    if (step === 'payment') {
      setStep('address');
    } else if (step === 'review') {
      setStep(isPrizeSimulation ? 'address' : 'payment');
    } else {
      router.back();
    }
  };

  const handleHardwareBackPress = useEffectEvent(() => {
    if (isOrderInFlight.current) return true;
    if (step === 'address') {
      Alert.alert(
        'Leave Checkout?',
        'Your cart items will be saved. Are you sure you want to leave?',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => router.back(),
          },
        ]
      );
      return true;
    }

    if (step === 'payment') {
      setStep('address');
    } else if (step === 'review') {
      setStep(isPrizeSimulation ? 'address' : 'payment');
    } else {
      router.back();
    }

    return true;
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleHardwareBackPress
    );
    return () => backHandler.remove();
  }, []);

  return { handleBack };
}
