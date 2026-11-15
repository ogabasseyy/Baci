import {
  ArrowUpRight,
  Leaf,
  ReceiptText,
  RefreshCw,
  Smartphone,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import { AccessStyles } from './access-styles';
import { OwnershipCompare } from './ownership-compare';
import { OWNERSHIP_STYLES } from './ownership-styles';

export function OwnershipSections({ basePath = '' }: { basePath?: string }) {
  const href = (path: string) => asRoute(`${basePath}${path}`);
  return (
    <div className="oga-access">
      <AccessStyles />
      <style href="ogabassey-ownership" precedence="high">
        {OWNERSHIP_STYLES}
      </style>
      <div className="oa-wrap">
        <section
          className="oa-section"
          id="ways-to-own"
          aria-labelledby="ways-to-own-title"
        >
          <div className="oa-section-heading">
            <div>
              <span className="oa-kicker">
                Your ambition. Your budget. Your pace.
              </span>
              <h2 id="ways-to-own-title">More ways to make it yours.</h2>
            </div>
            <p>
              A smaller upfront cost or a little saved at a time. Choose the
              path that works for you.
            </p>
          </div>
          <div className="oa-paths">
            <article className="oa-path">
              <span className="oa-step">01 / SMARTER VALUE</span>
              <div className="oa-path-art" aria-hidden="true">
                <Smartphone />
                <span>
                  new to you.
                  <br />
                  ready for more.
                </span>
              </div>
              <h3>
                Premium doesn’t
                <br />
                have to mean new.
              </h3>
              <p>
                Get more device for your money with premium pre-owned tech. The
                tools to learn, create and earn—with plenty of life left to
                give.
              </p>
              <Link
                className="oa-textlink"
                href={href('/products')}
                prefetch={false}
              >
                Explore devices <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </article>
            <article className="oa-path oa-path-featured">
              <span className="oa-step">02 / BUY NOW, PAY OVER TIME</span>
              <h3>
                Your device now.
                <br />
                The balance later.
              </h3>
              <div className="oa-deposit">
                25–40%<span>upfront on eligible payment plans</span>
              </div>
              <p>
                Get your device and spread the remaining balance over 3–6
                months.
              </p>
              <ol className="oa-journey" aria-label="Payment plan journey">
                <li>
                  <span aria-hidden="true">01</span>Pay deposit
                </li>
                <li>
                  <span aria-hidden="true">02</span>Get device
                </li>
                <li>
                  <span aria-hidden="true">03</span>Repay monthly
                </li>
              </ol>
              <Link
                className="oa-textlink"
                href={href('/contact')}
                prefetch={false}
              >
                Find your payment plan{' '}
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </article>
            <article className="oa-path oa-path-save">
              <span className="oa-step">03 / SAVE TOWARDS IT</span>
              <div className="oa-path-art" aria-hidden="true">
                <Wallet />
                <span>
                  small steps.
                  <br />
                  big upgrades.
                </span>
              </div>
              <h3>
                A little closer.
                <br />
                Every time you save.
              </h3>
              <p>
                Set money aside for your next device. Eligible savings plans
                earn interest to help you reach your goal sooner.
              </p>
              <ol
                className="oa-journey oa-journey-save"
                aria-label="Savings journey"
              >
                <li>
                  <span aria-hidden="true">01</span>Set a goal
                </li>
                <li>
                  <span aria-hidden="true">02</span>Build savings
                </li>
                <li>
                  <span aria-hidden="true">03</span>Get device
                </li>
              </ol>
              <Link
                className="oa-textlink"
                href={href('/wallet')}
                prefetch={false}
              >
                Explore your wallet{' '}
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </article>
          </div>
          <p className="oa-fineprint">
            Payment plans are subject to eligibility and provider approval.
            Deposit, duration, fees and total repayment depend on your offer.
            Interest applies to eligible savings plans, not all wallet balances;
            check availability, rates and withdrawal terms before saving.
          </p>
          <div data-ownership-compare>
            <OwnershipCompare basePath={basePath} />
          </div>
        </section>
        <section className="oa-planet" aria-labelledby="planet-title">
          <div className="oa-planet-symbol" aria-hidden="true">
            <div className="oa-planet-ring">
              <RefreshCw />
            </div>
            <span className="oa-planet-label">Repair. Reuse. Repeat.</span>
          </div>
          <div>
            <span className="oa-kicker">
              <Leaf size={13} aria-hidden="true" /> We love the environment.
            </span>
            <h2 id="planet-title">
              Good tech deserves
              <br />a longer story.
            </h2>
            <p>
              Buying pre-owned keeps useful devices in use. Repairing gives
              yours another chapter. Together, small choices help reduce
              e-waste.
            </p>
            <div className="oa-actions">
              <Link
                className="oa-textlink"
                href={href('/repairs')}
                prefetch={false}
              >
                Give your device a second life{' '}
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="oa-note">
              <ReceiptText size={15} aria-hidden="true" /> Digital receipts. One
              less piece of paper.
            </div>
          </div>
        </section>
        <div className="oa-section-heading oa-section">
          <div>
            <span className="oa-kicker">Made for what’s next</span>
            <h2>Small upgrade. Big possibilities.</h2>
          </div>
          <Link className="oa-button" href={href('/products')} prefetch={false}>
            Find your next device <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
