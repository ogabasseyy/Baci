module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Keep worklets on the supported transform path. Expo SDK 57.0.9+
      // includes the Hermes V1 memory fix; bundle mode is experimental.
      'react-native-worklets/plugin',
    ],
  };
};
