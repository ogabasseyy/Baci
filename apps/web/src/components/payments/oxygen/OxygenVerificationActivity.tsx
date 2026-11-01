import { Sparkles } from 'lucide-react';
import styles from './OxygenVerificationActivity.module.css';

/** Decorative activity, not a percentage or a promise of approval. */
export function OxygenVerificationActivity() {
  return (
    <div aria-hidden="true" className={styles.activity}>
      <span className={styles.pink} />
      <span className={styles.blue} />
      <span className={styles.gold} />
      <span className={styles.sparkle}>
        <Sparkles size={25} strokeWidth={1.8} />
      </span>
    </div>
  );
}
