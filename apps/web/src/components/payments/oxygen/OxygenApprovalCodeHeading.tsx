import { Mail } from 'lucide-react';
import type { Ref } from 'react';
import styles from './OxygenApprovalCode.module.css';

export function OxygenApprovalCodeHeading({
  headingRef,
}: {
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className={styles.codeHeader}>
      <span className={styles.mailIcon}>
        <Mail aria-hidden="true" className="size-5" />
      </span>
      <h3 ref={headingRef} tabIndex={-1}>
        Enter your approval code
      </h3>
      <p>Enter the 6-digit code sent to your email.</p>
    </header>
  );
}
