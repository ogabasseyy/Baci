/**
 * Zero-JavaScript twin of the interactive panel's rotating promo words
 * ("Airtime!" visible, the rest stacked invisibly): same elements, same
 * classes, same copy, so the activation swap is paint-only (no CLS).
 */
import { STATIC_ACTIVE_WORD_INDEX } from './static-utility-constants';

const STATIC_UTILITY_WORDS = ['Airtime!', 'Data!', 'TV!', 'Power!', 'Gaming!'];

export function StaticUtilityWords({
  minWidthClass,
}: {
  minWidthClass: string;
}) {
  return (
    <span
      className={`text-primary font-bold transition-all duration-500 inline-grid ${minWidthClass} text-left align-baseline`}
    >
      {STATIC_UTILITY_WORDS.map((word, index) => (
        <span
          aria-hidden={index === STATIC_ACTIVE_WORD_INDEX ? undefined : true}
          className={`col-start-1 row-start-1 ${index === STATIC_ACTIVE_WORD_INDEX ? '' : 'invisible'}`}
          key={word}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
