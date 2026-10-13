import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeModuleLoader = (moduleName: string) => unknown;

export function isQuizAudioAvailable(
  loadNativeModule: NativeModuleLoader = requireOptionalNativeModule
) {
  return loadNativeModule('ExpoAudio') !== null;
}
