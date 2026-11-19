import {
  OGABASSEY_WARRANTY_DETAILS,
  OGABASSEY_WARRANTY_SUMMARY,
} from '@baci/shared';
import { DeviceCareScreen } from '@/components/storefront/DeviceCareScreen';

export default function WarrantyScreen() {
  return (
    <DeviceCareScreen
      title="Warranty"
      heading="Help with device faults"
      intro={OGABASSEY_WARRANTY_SUMMARY}
      sections={[
        {
          title: 'Coverage and claims',
          icon: 'construct-outline',
          body: OGABASSEY_WARRANTY_DETAILS,
        },
      ]}
      links={[
        { label: 'Return Policy', href: '/returns' },
        { label: 'Ogabassey Assurance', href: '/device-protection' },
      ]}
    />
  );
}
