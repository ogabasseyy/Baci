import { HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS } from './hero-mobile-geometry';

/**
 * Zero-JavaScript twin of {@link HeroUtilityPanel}'s first frame.
 *
 * Renders the same markup the interactive panel server-renders before any
 * engagement (option index 0 active, stacked promo words with "Airtime!"
 * visible, modal closed): same elements, same class names, same copy, same
 * `data-*` hooks — minus the lucide `<svg>` icons (the `w-12 h-12` circles
 * keep their size, so the icon slots collapse to an empty fixed box with no
 * layout delta) and minus all event handlers.
 *
 * Intended render sites (the buttons stay handler-free until the
 * interactive module loads):
 *   - `HeroUtilityPanelGate` pre-activation fallback (visible homepage hero):
 *     identical boxes mean the activation swap is paint-only (no CLS) while
 *     the panel's client JS + icon modules stay out of the initial bundle.
 *     The gate shell is `aria-hidden` (NOT `inert`: inert subtrees are
 *     excluded from hit testing, which would hide the tapped option from
 *     first-tap replay); the `tabIndex={-1}` buttons take no tab stops.
 *   - `OgabasseyHomeHeroReserveFallback` geometry reservation (already
 *     `inert` + `aria-hidden`): exact panel height on both viewports with
 *     HTML bytes only.
 *
 * Parity is enforced by `hero-utility-panel-static.test.tsx`, which renders
 * both components and asserts the same text content, option labels, and
 * structural classes. When editing the interactive panel's first frame, edit
 * this file to match.
 */

const STATIC_UTILITY_WORDS = ['Airtime!', 'Data!', 'TV!', 'Power!', 'Gaming!'];

interface StaticUtilityOption {
  id: string;
  label: string;
}

const STATIC_UTILITY_OPTIONS: StaticUtilityOption[] = [
  { id: 'airtime', label: 'Airtime' },
  { id: 'data', label: 'Data' },
  { id: 'tv', label: 'Tv' },
  { id: 'power', label: 'Power' },
  { id: 'betting', label: 'Gaming' },
];

const STATIC_ACTIVE_INDEX = 0;

function StaticUtilityOptionButton({
  isActive,
  label,
  optionId,
  tone,
}: {
  isActive: boolean;
  label: string;
  optionId: string;
  tone: 'mobile' | 'desktop';
}) {
  const baseClass =
    tone === 'mobile'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-gray-50 text-gray-600 group-hover:bg-primary group-hover:text-white';
  const activeClass = 'bg-primary/10 text-primary';

  return (
    <button
      type="button"
      data-utility-option={optionId}
      tabIndex={-1}
      className="flex flex-col items-center gap-2 group cursor-pointer"
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-[background-color,color] duration-300 ${isActive ? activeClass : baseClass}`}
      >
        <span aria-hidden="true" className="block h-5 w-5" />
      </div>
      <span
        className={`text-xs font-medium transition-colors duration-300 ${isActive ? 'text-gray-900 font-bold' : 'text-gray-700'}`}
      >
        {label}
      </span>
    </button>
  );
}

function StaticUtilityWords({ minWidthClass }: { minWidthClass: string }) {
  return (
    <span
      className={`text-primary font-bold transition-all duration-500 inline-grid ${minWidthClass} text-left align-baseline`}
    >
      {STATIC_UTILITY_WORDS.map((word, index) => (
        <span
          aria-hidden={index === STATIC_ACTIVE_INDEX ? undefined : true}
          className={`col-start-1 row-start-1 ${index === STATIC_ACTIVE_INDEX ? '' : 'invisible'}`}
          key={word}
        >
          {word}
        </span>
      ))}
    </span>
  );
}

export function HeroUtilityPanelStatic() {
  return (
    <div
      className="w-full bg-white mt-3 md:mt-8 mb-6 border-y border-gray-100 md:py-5"
      data-ogabassey-hero-utility="true"
    >
      <div className="md:hidden px-4">
        <div
          className={`${HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS} bg-white rounded-3xl shadow-sm border border-gray-100 p-2`}
          data-ogabassey-mobile-utility-panel="true"
        >
          <div className="bg-primary/5 rounded-2xl py-3 px-4 mb-4 text-center">
            <span className="text-gray-900 font-medium text-sm">
              We Pay <span className="text-primary font-bold">YOU</span> When
              You Buy{' '}
              <StaticUtilityWords minWidthClass="min-w-[60px]" />
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2 px-1 pb-2">
            {STATIC_UTILITY_OPTIONS.map((option, index) => (
              <StaticUtilityOptionButton
                key={option.id}
                isActive={STATIC_ACTIVE_INDEX === index}
                label={option.label}
                optionId={option.id}
                tone="mobile"
              />
            ))}
          </div>
        </div>
      </div>

      <div className="hidden md:flex max-w-[1400px] mx-auto px-4 md:px-6 flex-row items-center justify-between">
        <div className="bg-primary/5 px-10 py-8 rounded-lg min-w-[280px] text-center xl:text-left xl:translate-x-[-5%]">
          <span className="text-gray-900 font-medium text-xl">
            We Pay <span className="text-primary font-bold">YOU</span> When
          </span>
        </div>

        <div className="flex justify-center gap-8 md:gap-12 flex-wrap">
          {STATIC_UTILITY_OPTIONS.map((option, index) => (
            <StaticUtilityOptionButton
              key={option.id}
              isActive={STATIC_ACTIVE_INDEX === index}
              label={option.label}
              optionId={option.id}
              tone="desktop"
            />
          ))}
        </div>

        <div className="hidden md:block bg-primary/5 px-10 py-8 rounded-lg min-w-[280px] text-center xl:text-right xl:translate-x-[5%]">
          <span className="text-gray-900 font-medium text-xl">
            You Buy <StaticUtilityWords minWidthClass="min-w-[80px]" />
          </span>
        </div>
      </div>
    </div>
  );
}
