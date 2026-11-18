import {
  OGABASSEY_CARE_INTRO,
  OGABASSEY_CHANGE_OF_MIND_BUYBACK,
  OGABASSEY_QUALITY_CHECKS,
  OGABASSEY_RETURN_HELP,
  OGABASSEY_RETURN_SHIPPING,
  OGABASSEY_RETURN_SUMMARY,
} from '@baci/shared';
import { DeviceCareScreen } from '@/components/storefront/DeviceCareScreen';

const qualityCheckIcons = [
  'document-text-outline',
  'cube-outline',
  'checkmark-circle-outline',
] as const;

export default function ReturnPolicyScreen() {
  return (
    <DeviceCareScreen
      title="Return Policy"
      heading="When something goes wrong"
      intro={OGABASSEY_CARE_INTRO}
      illustration={require('@/assets/images/campaigns/device-care.webp')}
      timelineCount={OGABASSEY_QUALITY_CHECKS.length}
      sections={[
        ...OGABASSEY_QUALITY_CHECKS.map((check, index) => ({
          ...check,
          icon: qualityCheckIcons[index] ?? 'checkmark-outline',
        })),
        {
          title: 'Your first 14 days',
          icon: 'calendar-outline',
          body: OGABASSEY_RETURN_SUMMARY,
        },
        {
          title: 'Before you send it back',
          icon: 'chatbubble-ellipses-outline',
          body: OGABASSEY_RETURN_HELP,
        },
        {
          title: 'Who pays for return shipping',
          icon: 'car-outline',
          body: OGABASSEY_RETURN_SHIPPING,
        },
        {
          title: 'Changed your mind?',
          icon: 'swap-horizontal-outline',
          body: OGABASSEY_CHANGE_OF_MIND_BUYBACK,
        },
      ]}
      betweenSections={{
        after: 2,
        label: 'Explore Ogabassey Assurance',
        href: '/device-protection',
      }}
      links={[{ label: 'Read the warranty', href: '/warranty' }]}
    />
  );
}
