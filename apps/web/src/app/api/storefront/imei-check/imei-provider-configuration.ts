import 'server-only';
import {
  getImeiDisabledTierKeys,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getSickwApiKey,
  isPetrockEnabled,
} from '@/env';

/** The provider settings prepareImeiProvider reads (one copy, shared). */
export const imeiProviderConfiguration = {
  getImeiDisabledTierKeys,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getSickwApiKey,
  isPetrockEnabled,
};
