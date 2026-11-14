import {
  OGABASSEY_ASSURANCE_HELP,
  OGABASSEY_ASSURANCE_SUMMARY,
} from '@baci/shared';
import { DeviceCareScreen } from '@/components/storefront/DeviceCareScreen';

export default function DeviceProtectionScreen() {
  return (
    <DeviceCareScreen
      title="Device Protection"
      heading="Ogabassey Assurance"
      intro={OGABASSEY_ASSURANCE_SUMMARY}
      sections={[
        {
          title: 'Claims and extensions',
          icon: 'shield-checkmark-outline',
          body: OGABASSEY_ASSURANCE_HELP,
        },
      ]}
      links={[
        { label: 'View cart', href: '/cart' },
        { label: 'Read the warranty', href: '/warranty' },
      ]}
    />
  );
}
