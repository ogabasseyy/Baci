import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';

export function OxygenSignatureControls({
  expanded,
  showClear,
  onClear,
  onToggle,
}: {
  expanded: boolean;
  showClear: boolean;
  onClear: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      {showClear && (
        <button
          type="button"
          aria-label="Clear"
          className="absolute bottom-2 left-2 flex size-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          onClick={onClear}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
        </button>
      )}
      <button
        type="button"
        aria-label={expanded ? 'Reduce signing area' : 'Expand signing area'}
        aria-pressed={expanded}
        className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={onToggle}
      >
        {expanded ? (
          <Minimize2 aria-hidden="true" className="size-4" />
        ) : (
          <Maximize2 aria-hidden="true" className="size-4" />
        )}
      </button>
    </>
  );
}
