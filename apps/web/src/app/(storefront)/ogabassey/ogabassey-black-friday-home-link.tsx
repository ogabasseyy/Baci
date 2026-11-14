import Link from 'next/link';
import { BLACK_FRIDAY_PATH } from '@/config/ogabassey-black-friday';
import { asRoute } from '@/lib/routes';
import styles from './ogabassey-black-friday-home-link.module.css';

export function OgabasseyBlackFridayHomeLink({
  pathPrefix,
}: {
  pathPrefix: string;
}) {
  return (
    <div className="mx-auto my-5 max-w-7xl px-4 sm:px-6">
      <Link
        aria-label="Shop Black Friday"
        className={styles.banner}
        href={asRoute(`${pathPrefix}${BLACK_FRIDAY_PATH}`)}
        prefetch={false}
      >
        <span className={styles.title}>
          Black <span>Friday</span>
        </span>
        <span className={styles.action} aria-hidden="true">
          Shop the lineup →
        </span>
      </Link>
    </div>
  );
}
