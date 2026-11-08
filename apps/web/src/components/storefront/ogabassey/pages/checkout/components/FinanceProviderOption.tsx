'use client';
import { CalendarDays, ChevronDown, HandCoins, Landmark } from 'lucide-react';
import Image, { type StaticImageData } from 'next/image';
import { useEffect, useState } from 'react';
import { FinanceBankLogo } from './FinanceBankLogo';
import { oxygenBankListSchema } from '@/schemas/oxygen-bank-details';
import type { PaymentMethod } from '../types';
import { creditDirectBanks } from './credit-direct-banks';
import styles from './finance-provider-option.module.css';

type Bank = { name: string; code: string };
export function FinanceProviderOption({ provider, selected, onSelect, logo }: {
  provider: 'oxygen' | 'credit_direct'; selected: boolean; onSelect: (v: PaymentMethod) => void; logo: StaticImageData;
}) {
  const oxygen = provider === 'oxygen';
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!oxygen || !selected) return;
    const controller = new AbortController();
    setUnavailable(false);
    void fetch('/api/payments/oxygen/supported-banks', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('unavailable'); return oxygenBankListSchema.parse(await response.json()).banks; })
      .then((result) => { if (!controller.signal.aborted) setBanks(result); })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [oxygen, selected]);
  const items: readonly Bank[] | null = oxygen ? banks : creditDirectBanks;
  const title = oxygen ? 'Oxygen Finance' : 'Credit Direct';
  return <div className={`${styles.option} ${selected ? styles.selected : ''}`}>
    <label className={styles.header}>
      <input type="radio" name="payment" value={provider} checked={selected} onChange={() => onSelect(provider)} className="sr-only" />
      <span className={`${styles.logoTile} ${oxygen ? styles.oxygenLogoTile : styles.creditLogoTile}`}><Image src={logo} alt={oxygen ? 'Oxygen X Finance Company' : 'Credit Direct lending logo'} width={48} height={40} className={styles.logo} /></span>
      <span className={styles.content}><span className={styles.title}>{title}</span><span className={styles.chips}><span><HandCoins size={13} aria-hidden="true" /> From {oxygen ? '25%' : '30%'} down</span><span><CalendarDays size={13} aria-hidden="true" /> {oxygen ? '3–12' : '3–6'} months</span></span></span>
      <span className={styles.dot} aria-hidden="true" />
    </label>
    {selected && <details className={styles.details}><summary><span className={styles.bankBadge}><Landmark size={13} aria-hidden="true" />{items ? `${items.length} supported banks` : 'Supported banks'}</span> {items && items.length > 8 && <span className={styles.scrollHint}>Scroll ↓</span>}<ChevronDown size={17} aria-hidden="true" /></summary>
      {items ? <div className={styles.grid} role="region" tabIndex={0} aria-label={`${title} supported banks`}>{items.map(({name,code}) => <div className={styles.bank} key={`${name}-${code}`}><FinanceBankLogo name={name} code={code}/><span>{name}</span></div>)}</div> : <p className={styles.message}>{unavailable ? 'Bank list is temporarily unavailable.' : 'Loading supported banks…'}</p>}
    </details>}
  </div>;
}
