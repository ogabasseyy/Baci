import { getExpoAccessToken } from '@/env';
import { createLazyExpoGetter } from './expo-push-lazy-client';

/** Expo client for restricted workers that deliver through a `PushDelivery`. */
export const getExpoClient = createLazyExpoGetter(() => getExpoAccessToken());
