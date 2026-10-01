import { TurboModuleRegistry } from 'react-native';

type NativeModuleLoader = (moduleName: string) => unknown;

export function isQuizMobileAdsAvailable(
  loadNativeModule: NativeModuleLoader = TurboModuleRegistry.get
): boolean {
  return loadNativeModule('RNGoogleMobileAdsModule') !== null;
}
