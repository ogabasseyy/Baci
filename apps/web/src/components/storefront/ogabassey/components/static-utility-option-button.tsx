/**
 * Zero-JavaScript twin of one interactive utility option button: the same
 * `w-12 h-12` icon circle (empty fixed box — the lucide `<svg>` is omitted
 * with no layout delta), the same label, the same `data-utility-option`
 * hook for first-tap replay — minus all event handlers (`tabIndex={-1}`).
 */
export function StaticUtilityOptionButton({
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
