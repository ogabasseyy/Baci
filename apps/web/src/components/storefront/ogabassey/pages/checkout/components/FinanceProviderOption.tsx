'use client';
import { CalendarDays, ChevronDown, HandCoins, Landmark } from 'lucide-react';
import Image, { type StaticImageData } from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useCheckoutSessionUser } from '../hooks/use-checkout-session-user';
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
  const userId = useCheckoutSessionUser()?.id;
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const cooldownOwner = useRef<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [authRequired, setAuthRequired] = useState(false);
  const retryAfter = retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - clock) / 1000));
  useEffect(() => {
    if (retryDeadline === null) return;
    const updateClock = () => setClock(Date.now());
    const timer = setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', updateClock);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', updateClock); };
  }, [retryDeadline]);
  useEffect(() => {
    if (!oxygen || !selected) return;
    if (retryDeadline !== null && retryDeadline > Date.now() && !(cooldownOwner.current && userId && cooldownOwner.current !== userId)) return;
    const controller = new AbortController();
    cooldownOwner.current = null;
    setRetryDeadline(null);
    setUnavailable(false);
    setAuthRequired(false);
    void fetch('/api/payments/oxygen/supported-banks', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) { if (!controller.signal.aborted) setAuthRequired(true); throw new Error('unauthorized'); }
        if (response.status === 429) {
          if (!controller.signal.aborted) cooldownOwner.current = response.headers.get('X-Oxygen-Rate-Limit-Scope') === 'user' ? response.headers.get('X-Oxygen-Rate-Limit-User') || userId || null : null;
          const header = response.headers.get('Retry-After');
          const seconds = header === null || header.trim() === '' ? NaN : Number(header);
          const now = Date.now();
          if (!controller.signal.aborted) { setClock(now); setRetryDeadline(now + (Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : 60) * 1000); }
          throw new Error('rate-limited');
        }
        if (!response.ok) throw new Error('unavailable');
        if (!controller.signal.aborted) setRetryDeadline(null);
        return oxygenBankListSchema.parse(await response.json()).banks;
      })
      .then((result) => { if (!controller.signal.aborted) setBanks(result); })
      .catch(() => { if (!controller.signal.aborted) { setBanks(null); setUnavailable(true); } });
    return () => controller.abort();
  // A cooldown survives reselection or sign-in; after it expires, retry remains deliberate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retries must be deliberate; auth changes also refresh the list
  }, [oxygen, selected, retry, userId]);
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
      {items ? <div className={styles.grid} role="region" tabIndex={0} aria-label={`${title} supported banks`}>{items.map(({name,code}) => <div className={styles.bank} key={`${name}-${code}`}><FinanceBankLogo name={name} code={code}/><span>{name}</span></div>)}</div> : <div className={styles.message}>{unavailable ? <>{authRequired ? 'Sign in to view supported banks.' : retryAfter === null ? 'Bank list is temporarily unavailable.' : retryAfter > 0 ? `Too many requests. Please try again in ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.` : 'You can try again now.'} {!authRequired && <button type="button" disabled={retryAfter !== null && retryAfter > 0} onClick={() => { setUnavailable(false); setRetry((value) => value + 1); }}>Retry bank list</button>}</> : 'Loading supported banks…'}</div>}
    </details>}
  </div>;
}
