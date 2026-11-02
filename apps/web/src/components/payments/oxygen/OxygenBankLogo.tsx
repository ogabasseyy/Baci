'use client';

import { Landmark } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { oxygenBankLogo } from './oxygen-bank-logos';

export function OxygenBankLogo({ code }: { code: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  const source = oxygenBankLogo(code);
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white p-1"
    >
      {source && failedSource !== source ? (
        <Image
          src={source}
          alt=""
          width={24}
          height={24}
          className="size-6 object-contain"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <Landmark className="size-4 text-gray-400" />
      )}
    </span>
  );
}
