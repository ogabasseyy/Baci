import { createContext, type ReactNode, useContext, useState } from 'react';

/** Synthetic local interactions only: no network, cart session, order or payment. */
interface QualificationApi {
  count: number;
  add(): void;
  navigate(path: string): void;
}
const QualificationContext = createContext<QualificationApi | null>(null);
export function QualificationCommerce({
  children,
  navigate,
}: {
  children: ReactNode;
  navigate(path: string): void;
}) {
  const [count, setCount] = useState(0);
  return (
    <QualificationContext.Provider
      value={{ count, add: () => setCount((n) => n + 1), navigate }}
    >
      {children}
    </QualificationContext.Provider>
  );
}
export function useQualificationCommerce() {
  const value = useContext(QualificationContext);
  if (!value) throw new Error('Synthetic commerce provider missing');
  return value;
}
