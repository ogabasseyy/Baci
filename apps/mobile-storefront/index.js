const { markStartupTiming } = require('./lib/startup-timing');
markStartupTiming('js_entry');
require('react-native-gesture-handler');
require('react-native-reanimated');
const Crypto = require('expo-crypto');

// Polyfill for crypto.getRandomValues (required by Supabase/OAuth helpers)
if (typeof global.crypto === 'undefined') {
  global.crypto = {
    getRandomValues: (array) => {
      Crypto.getRandomValues(array);
      return array;
    },
  };
}

if (process.env.EXPO_PUBLIC_LOCAL_STOREFRONT === '1') {
  require('./lib/install-local-storefront-runtime').installLocalStorefrontRuntime();
}

const { initializeErrorMonitoring } = require('./services/error-monitoring');

initializeErrorMonitoring();
markStartupTiming('error_monitoring_complete');

require('expo-router/entry');
markStartupTiming('router_entry_loaded');
