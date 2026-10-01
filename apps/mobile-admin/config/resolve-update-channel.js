const UPDATE_CHANNELS = new Set(['development', 'preview', 'production']);

function readSupportedChannel(rawChannel) {
  const channel = rawChannel?.trim();
  return channel && UPDATE_CHANNELS.has(channel) ? channel : undefined;
}

function resolveUpdateChannel(environment) {
  const configuredChannels = [
    environment.EXPO_UPDATE_CHANNEL,
    environment.EXPO_PUBLIC_ENV,
    environment.EAS_BUILD_PROFILE,
  ];

  for (const configuredChannel of configuredChannels) {
    const supportedChannel = readSupportedChannel(configuredChannel);
    if (supportedChannel) {
      return supportedChannel;
    }
  }

  return 'production';
}

module.exports = { resolveUpdateChannel };
