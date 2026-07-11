'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useEffect, useState } from 'react';
import styles from './AppFrame.module.css';
import { icons } from './icons';
import { StackarrMark } from './StackarrMark';
import { SearchInput } from './ui';

type NavItem = { href: string; label: string; icon: typeof icons.dashboard };
type NavGroup = { label: string; items: NavItem[] };

const setupNavItem: NavItem = { href: '/setup', label: 'Finish setup', icon: icons.play };

const appNav: NavGroup[] = [
  {
    label: 'Control plane',
    items: [
      { href: '/', label: 'Home', icon: icons.dashboard },
      { href: '/stack/services', label: 'Apps', icon: icons.stack },
      { href: '/activity/queue', label: 'Activity', icon: icons.activity },
      { href: '/containers', label: 'Infrastructure', icon: icons.containers },
      { href: '/agent', label: 'Automation & access', icon: icons.manage },
      { href: '/settings', label: 'Settings', icon: icons.settings }
    ]
  }
];

export function AppFrame({ children, setupComplete }: { children: React.ReactNode; setupComplete: boolean }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const nav = setupComplete ? appNav : [{ label: 'Get started', items: [setupNavItem] }, ...appNav];
  const brandHref = setupComplete ? '/' : '/setup';

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <aside className={`${styles.sidebar} ${mobileMenuOpen ? styles.sidebarOpen : ''}`}>
        <Link className={styles.brand} href={brandHref}>
          <StackarrMark size={32} />
          <span>
            <strong>Stackarr</strong>
            <small>Homelab control plane</small>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          {nav.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <span className={styles.navLabel}>{group.label}</span>
              {group.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const ItemIcon = item.icon;

                return (
                  <Link
                    key={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={active ? styles.active : styles.item}
                    href={item.href}
                  >
                    <span className={styles.iconWell}>
                      <ItemIcon aria-hidden="true" className={styles.icon || ''} size={16} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.connectionDot} aria-hidden="true" />
          <span>
            <strong>Listening</strong>
            <small>Actions and server events</small>
          </span>
        </div>
      </aside>
      {mobileMenuOpen && (
        <button
          aria-label="Close navigation"
          className={styles.mobileScrim}
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}
      <main className={styles.main} id="main-content">
        <div className={styles.mobileHeader}>
          <Link className={styles.mobileBrand} href={brandHref}>
            <StackarrMark size={28} />
            <strong>Stackarr</strong>
          </Link>
          <button
            aria-expanded={mobileMenuOpen}
            aria-label="Open navigation"
            className={styles.menuButton}
            onClick={() => setMobileMenuOpen((open) => !open)}
            type="button"
          >
            <icons.sliders aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </main>
      <nav className={styles.mobileNav} aria-label="Main mobile navigation">
        {appNav[0]!.items
          .filter((item) => !['/settings', '/agent'].includes(item.href))
          .map((item) => {
            const active = isNavItemActive(item, pathname);
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? styles.mobileNavActive : styles.mobileNavItem}
                href={item.href}
              >
                <ItemIcon aria-hidden="true" size={17} />
                <span>
                  {item.label === 'Automation & access'
                    ? 'Automate'
                    : item.label === 'Infrastructure'
                      ? 'Infra'
                      : item.label}
                </span>
              </Link>
            );
          })}
      </nav>
    </div>
  );
}

function isNavItemActive(item: NavItem, pathname: string) {
  if (item.href === '/') return pathname === '/';
  if (item.href === '/activity/queue') return pathname.startsWith('/activity') || pathname === '/system/logs';
  if (item.href === '/agent') {
    return pathname.startsWith('/agent') || pathname === '/settings/connect' || pathname === '/system/events';
  }
  if (item.href === '/settings') {
    return pathname.startsWith('/settings') && pathname !== '/settings/connect';
  }
  return pathname.startsWith(item.href);
}

export function Toolbar({
  title,
  description,
  actions,
  searchTerm,
  onSearch
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  searchTerm?: string;
  onSearch?: (term: string) => void;
}) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.pageTitle}>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className={styles.actions}>
        {onSearch && (
          <SearchInput value={searchTerm || ''} onChange={onSearch} placeholder="Search queue, history, services..." />
        )}
        {actions}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

export function IconButton({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button className={styles.iconButton} title={title} aria-label={title}>
      {children}
    </button>
  );
}

export const toolbarIcons = {
  Download: icons.download,
  SlidersHorizontal: icons.sliders
};
