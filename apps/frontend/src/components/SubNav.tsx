'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SubNav.module.css';

export type SubNavItem = {
  href: string;
  label: string;
};

export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className={styles.subnav}>
      {items.map((item) => (
        <Link key={item.href} className={pathname === item.href ? styles.active : styles.item} href={item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
