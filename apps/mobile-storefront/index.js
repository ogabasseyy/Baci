import 'react-native-gesture-handler';
import 'react-native-reanimated';
import * as Crypto from 'expo-crypto';

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

require('expo-router/entry');
