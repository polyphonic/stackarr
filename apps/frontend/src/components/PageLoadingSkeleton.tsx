import { Skeleton } from '@stackarr/ui';
import styles from './PageLoadingSkeleton.module.css';

export function PageLoadingSkeleton({ cards = 4, label = 'Loading page' }: { cards?: number; label?: string }) {
  return (
    <div className={`${styles.loading} skeleton--shimmer`} aria-label={label} role="status">
      <div className={styles.summary}>
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton animationType="none" key={index} />
        ))}
      </div>
      <Skeleton animationType="none" className={styles.heading} />
      <div className={styles.rows}>
        <Skeleton animationType="none" />
        <Skeleton animationType="none" />
        <Skeleton animationType="none" />
      </div>
      <span className={styles.srOnly}>{label}</span>
    </div>
  );
}
