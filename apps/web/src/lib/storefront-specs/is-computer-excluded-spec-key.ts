const COMPUTER_EXCLUDED_KEYS = new Set([
  'has_fm_radio',
  'android_version',
  'has_ois',
  'main_camera_mp',
  'rear_camera_features',
  'rear_camera_video',
  'front_camera_mp',
  'front_camera_features',
  'front_camera_video',
]);

export function isComputerExcludedSpecKey(key: string) {
  return COMPUTER_EXCLUDED_KEYS.has(key);
}
