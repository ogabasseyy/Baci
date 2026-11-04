import styles from './OxygenApplicationDialog.module.css';

const stages = ['Identity', 'Bank', 'Income'];

export function OxygenFormProgress({ step }: { step: number }) {
  return (
    <ol aria-label="Application progress" className={styles.steps}>
      {stages.map((name, index) => (
        <li
          key={name}
          aria-current={index === step ? 'step' : undefined}
          data-state={
            index === step ? 'current' : index < step ? 'complete' : 'upcoming'
          }
          className={styles.step}
        >
          <span aria-hidden="true" className={styles.number}>
            {index + 1}
          </span>
          <span>{name}</span>
        </li>
      ))}
    </ol>
  );
}
