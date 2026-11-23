import type { ReactNode } from 'react';

/** Shows one guided turn while retaining the earlier answers for form submission. */
export function OxygenChatQuestion({
  current,
  turn,
  prompt,
  children,
}: {
  current?: number;
  turn: number;
  prompt: string;
  children: ReactNode;
}) {
  if (current === undefined) return children;
  return (
    <div data-oxygen-chat-question={turn} hidden={current !== turn}>
      <p
        role="status"
        className="mb-3 rounded-2xl rounded-tl-sm bg-rose-50 px-4 py-3 text-sm leading-relaxed text-gray-900"
      >
        {prompt}
      </p>
      {children}
    </div>
  );
}

export const oxygenIdentityTurns = { bvn: 0, nin: 1, dob: 2 } as const;
export const oxygenBankTurns = { bank: 0, account: 1 } as const;
export const oxygenIncomeTurns = {
  employment: 0,
  employer: 1,
  amount: 2,
  payday: 3,
  address: 4,
  consent: 5,
} as const;
