import type { ImeiCheckField } from '@baci/shared/imei';
import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { ImeiResult } from '@/lib/validation';

export interface ImeiResultStatusCard {
  cleanAware?: boolean;
  /** Read with the shared blacklist rules ("Not Blacklisted" is clean). */
  blacklist?: boolean;
  /** Unlocked reads clean; locked to one network reads as caution. */
  simLock?: boolean;
  icon: IoniconsIconName;
  label: string;
  value: string;
}

export function getImeiResultStatusCards(
  result: ImeiResult,
  checksIncluded: readonly ImeiCheckField[]
): ImeiResultStatusCard[] {
  // The core status cards render "Unknown" when the provider omits them, so
  // they are gated on what the tier actually checks — a serial-info report
  // otherwise shows a wall of Unknown blacklist/iCloud/SIM/carrier cards it
  // never looked up. Optional cards stay value-gated: when the provider
  // returns bonus data the tier didn't promise, showing it is a feature.
  const included = new Set<ImeiCheckField>(checksIncluded);
  return [
    included.has('blacklistStatus')
      ? {
          blacklist: true,
          cleanAware: true,
          icon: 'shield-checkmark' as const,
          label: 'Blacklist Status',
          value: result.blacklistStatus,
        }
      : null,
    optionalStatusCard(result.activationStatus, {
      icon: 'sparkles',
      label: 'Activation Status',
    }),
    optionalStatusCard(result.miLockStatus, {
      cleanAware: true,
      icon: 'lock-closed-outline',
      label: 'Mi Lock Status',
    }),
    optionalStatusCard(result.miLostStatus, {
      cleanAware: true,
      icon: 'shield-outline',
      label: 'Mi Lost Status',
    }),
    // Both iCloud cards ride on the 'icloud' check (icloudLock has no
    // separate ImeiCheckField).
    included.has('icloud')
      ? {
          cleanAware: true,
          icon: 'cloud-outline' as const,
          label: 'iCloud Status',
          value: result.icloud,
        }
      : null,
    included.has('icloud')
      ? {
          cleanAware: true,
          icon: 'lock-closed' as const,
          label: 'Find My iPhone',
          value: result.icloudLock,
        }
      : null,
    included.has('simLock')
      ? {
          icon: 'globe' as const,
          label: 'SIM Lock',
          simLock: true,
          value: result.simLock,
        }
      : null,
    included.has('carrier')
      ? {
          icon: 'cellular' as const,
          label: 'Carrier',
          value: result.carrier,
        }
      : null,
    optionalStatusCard(result.serialNumber, {
      icon: 'barcode-outline',
      label: 'Serial Number',
    }),
    optionalStatusCard(result.purchaseDate, {
      icon: 'calendar-outline',
      label: 'Purchase Date',
    }),
    optionalStatusCard(result.purchaseCountry, {
      icon: 'earth-outline',
      label: 'Purchase Country',
    }),
    optionalStatusCard(result.warranty, {
      icon: 'shield-checkmark-outline',
      label: 'Warranty',
    }),
    optionalStatusCard(result.refurbished, {
      cleanAware: true,
      icon: 'refresh-outline',
      label: 'Refurbished',
    }),
    optionalStatusCard(result.demoUnit, {
      cleanAware: true,
      icon: 'phone-portrait-outline',
      label: 'Demo Unit',
    }),
    optionalStatusCard(result.mdmStatus, {
      cleanAware: true,
      icon: 'briefcase-outline',
      label: 'MDM Status',
    }),
    optionalStatusCard(result.knoxGuardStatus, {
      cleanAware: true,
      icon: 'lock-closed-outline',
      label: 'Knox Guard',
    }),
    optionalStatusCard(result.gsxCoverage, {
      // Neutral: gsxCoverage is raw provider text that can read
      // "Expired"/"Out of Coverage", so a fixed success green would mislead.
      icon: 'shield-checkmark-outline',
      label: 'Coverage',
    }),
    optionalStatusCard(result.repairEligibility, {
      icon: 'build-outline',
      label: 'Repair Eligibility',
    }),
    optionalStatusCard(result.repairHistory, {
      cleanAware: true,
      icon: 'construct-outline',
      label: 'Repair History',
    }),
    optionalStatusCard(result.replacementHistory, {
      cleanAware: true,
      icon: 'refresh-outline',
      label: 'Replacement History',
    }),
    optionalStatusCard(result.partNumber, {
      icon: 'pricetag-outline',
      label: 'Part Number',
    }),
    optionalStatusCard(result.esimCompatibility, {
      icon: 'radio-outline',
      label: 'eSIM Compatibility',
    }),
    optionalStatusCard(result.financeStatus, {
      cleanAware: true,
      icon: 'cash-outline',
      label: 'Finance Status',
    }),
    optionalStatusCard(result.knoxEnrollment, {
      cleanAware: true,
      icon: 'shield-checkmark-outline',
      label: 'Knox Enrollment',
    }),
    optionalStatusCard(result.soldBy, {
      icon: 'business-outline',
      label: 'Sold By',
    }),
    optionalStatusCard(result.wifiMac, {
      icon: 'wifi-outline',
      label: 'Wi-Fi MAC',
    }),
    optionalStatusCard(result.devicePhoto, {
      icon: 'image-outline',
      label: 'Device Photo',
    }),
  ].filter((card): card is ImeiResultStatusCard => Boolean(card));
}

function optionalStatusCard(
  value: string | undefined,
  config: Omit<ImeiResultStatusCard, 'value'>
): ImeiResultStatusCard | null {
  return value ? { ...config, value } : null;
}
