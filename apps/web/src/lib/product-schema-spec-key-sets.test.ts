import { describe, expect, it } from 'vitest';
import {
  AUDIO_CAPABILITY_SPEC_KEYS,
  AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS,
  CAMERA_KEY_SPEC_KEYS,
  CAMERA_ONLY_SPEC_KEYS,
  COMPUTER_CELLULAR_SPEC_KEYS,
  COMPUTER_HARDWARE_SPEC_KEYS,
  NETWORK_DEVICE_CELLULAR_SPEC_KEYS,
  PHONE_ONLY_SPEC_KEYS,
} from './product-schema-spec-key-sets';

describe('product schema spec key sets', () => {
  it('keeps camera-only keys separate from phone-only keys', () => {
    expect(CAMERA_ONLY_SPEC_KEYS).toEqual(
      new Set([
        'has_ois',
        'has_reverse_charging',
        'main_camera_mp',
        'rear_camera_features',
        'rear_camera_video',
        'front_camera_mp',
        'front_camera_features',
        'front_camera_video',
      ])
    );
    expect(PHONE_ONLY_SPEC_KEYS).toEqual(
      new Set([
        'android_version',
        'fingerprint_type',
        'has_5g',
        'has_card_slot',
        'has_fm_radio',
        'has_headphone_jack',
        'has_nfc',
        'has_stereo_speakers',
        'network_technology',
        'sim_type',
      ])
    );
    for (const key of CAMERA_ONLY_SPEC_KEYS) {
      expect(PHONE_ONLY_SPEC_KEYS.has(key)).toBe(false);
    }
  });

  it('projects camera family key specs into CAMERA_KEY_SPEC_KEYS', () => {
    expect(CAMERA_KEY_SPEC_KEYS.size).toBeGreaterThan(0);
    expect(CAMERA_KEY_SPEC_KEYS.has('has_ois')).toBe(true);
    expect(CAMERA_KEY_SPEC_KEYS.has('main_camera_mp')).toBe(true);
  });

  it('scopes audio, computer, and network capability keys', () => {
    expect(AUDIO_CAPABILITY_SPEC_KEYS).toEqual(
      new Set(['has_headphone_jack', 'has_stereo_speakers'])
    );
    expect(COMPUTER_CELLULAR_SPEC_KEYS).toEqual(
      new Set(['has_5g', 'has_nfc', 'network_technology', 'sim_type'])
    );
    expect(NETWORK_DEVICE_CELLULAR_SPEC_KEYS).toEqual(
      new Set(['has_5g', 'network_technology', 'sim_type'])
    );
    expect(COMPUTER_HARDWARE_SPEC_KEYS).toEqual(new Set(['fingerprint_type']));
  });

  it('maps authoritative false capabilities to legacy keys that should be suppressed', () => {
    expect(
      AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS.find(
        (entry) => entry.authoritativeKey === 'has_wireless_charging'
      )
    ).toEqual({
      authoritativeKey: 'has_wireless_charging',
      suppressedKeys: ['has_wireless_charging', 'wireless_charging_watt'],
    });
    expect(
      new Set(
        AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS.map(
          (entry) => entry.authoritativeKey
        )
      ).size
    ).toBe(AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS.length);
  });
});
