import Link from 'next/link';

interface SantaChatHeaderProps {
  onClose?: () => void;
  merchantSlug: string | null;
  cartCount: number;
}

export function SantaChatHeader({
  onClose,
  merchantSlug,
  cartCount,
}: SantaChatHeaderProps) {
  return (
    <header
      className="bg-red-600 p-4 text-white shadow-lg sticky top-0 z-10 flex items-center justify-between"
      style={{
        borderBottom: '4px solid #a4171d',
      }}
    >
      {/* Left: Back/Close button */}
      <div className="w-16">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="p-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="size-6"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Title */}
      <div className="text-center">
        <h1
          className="text-2xl md:text-3xl tracking-wider"
          style={{
            fontFamily: '"Mountains of Christmas", cursive',
            textShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          Santa&apos;s Workshop
        </h1>
      </div>

      {/* Right: Cart icon with count */}
      <div className="w-16 flex items-center justify-end gap-2">
        <Link
          href={merchantSlug ? `/${merchantSlug}/cart` : '/cart'}
          className="p-2 relative"
          aria-label={`View Cart (${cartCount} items)`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-6"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M7.5 6v.75H5.513c-.96 0-1.763.746-1.858 1.705L3.11 18.238A3 3 0 0 0 6.077 21h11.846a3 3 0 0 0 2.967-2.762l-.545-9.783A1.875 1.875 0 0 0 18.487 6.75H16.5V6a4.5 4.5 0 0 0-9 0Zm1.5 0V6a3 3 0 0 1 6 0v.75H9Z"
              clipRule="evenodd"
            />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs font-bold rounded-full size-5 flex items-center justify-center">
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
