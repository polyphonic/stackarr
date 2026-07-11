import type { GlassIcon } from '@stackarr/ui';
import Link from 'next/link';
import styles from './DestinationCard.module.css';

export function DestinationCard({
  href,
  icon: Icon,
  title,
  description
}: {
  href: string;
  icon: GlassIcon;
  title: string;
  description: string;
}) {
  return (
    <Link className={styles.card} href={href}>
      <span>
        <Icon aria-hidden="true" size={19} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <b aria-hidden="true">›</b>
    </Link>
  );
}
