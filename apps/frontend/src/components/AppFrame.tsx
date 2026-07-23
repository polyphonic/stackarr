'use client';

import { toast } from '@stackarr/ui/toast';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './AppFrame.module.css';
import { icons } from './icons';
import { ServiceLogo } from './ServiceLogo';
import { StackarrMark } from './StackarrMark';
import {
  loadServiceFavorites,
  type ServiceFavorite,
  subscribeServiceFavorites,
  writeServiceFavorites
} from './serviceFavorites';
import { SearchInput } from './ui';

type NavItem = { href: string; label: string; icon: typeof icons.dashboard };
type NavGroup = { label: string; items: NavItem[] };

const setupNavItem: NavItem = { href: '/setup', label: 'Finish Setup', icon: icons.play };

const appNav: NavGroup[] = [
  {
    label: 'Control Plane',
    items: [
      { href: '/', label: 'Home', icon: icons.dashboard },
      { href: '/stack/services', label: 'Apps', icon: icons.stack },
      { href: '/activity/queue', label: 'Activity', icon: icons.activity },
      { href: '/containers', label: 'Containers', icon: icons.containers },
      { href: '/agent', label: 'Agents', icon: icons.manage },
      { href: '/settings', label: 'Settings', icon: icons.settings }
    ]
  }
];

export function AppFrame({
  children,
  initialFavorites,
  setupComplete,
  version,
  channel
}: {
  children: React.ReactNode;
  initialFavorites: ServiceFavorite[];
  setupComplete: boolean;
  version: string;
  channel: string;
}) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [favoriteOrderMessage, setFavoriteOrderMessage] = useState('');
  const draggedFavorite = useRef<string | null>(null);
  const nav = setupComplete ? appNav : [{ label: 'Get Started', items: [setupNavItem] }, ...appNav];
  const brandHref = setupComplete ? '/' : '/setup';

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem('stackarr-sidebar-collapsed') === 'true');
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadServiceFavorites().then((next) => {
      if (mounted) setFavorites(next);
    });
    const unsubscribe = subscribeServiceFavorites(setFavorites);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function moveFavorite(name: string, targetIndex: number) {
    const sourceIndex = favorites.findIndex((favorite) => favorite.name === name);
    const boundedTarget = Math.max(0, Math.min(targetIndex, favorites.length - 1));
    if (sourceIndex < 0 || sourceIndex === boundedTarget) return;

    const previous = favorites;
    const next = [...favorites];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(boundedTarget, 0, moved);
    setFavorites(next);
    setFavoriteOrderMessage(`${moved.displayName} moved to position ${boundedTarget + 1}.`);

    try {
      await writeServiceFavorites(next.map((favorite) => favorite.name));
    } catch (error) {
      setFavorites(previous);
      toast.error(error instanceof Error ? error.message : 'Could not save pinned app order.');
    }
  }

  return (
    <div className={`${styles.shell} ${sidebarCollapsed ? styles.shellCollapsed : ''}`}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <aside className={`${styles.sidebar} ${mobileMenuOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brandRow}>
          <Link className={styles.brand} href={brandHref} title={sidebarCollapsed ? 'Stackarr' : undefined}>
            <StackarrMark size={32} />
            <span>
              <strong>Stackarr</strong>
              <small>Homelab Control Plane</small>
            </span>
          </Link>
          <button
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={!sidebarCollapsed}
            className={styles.sidebarToggle}
            onClick={() => {
              setSidebarCollapsed((collapsed) => {
                const next = !collapsed;
                window.localStorage.setItem('stackarr-sidebar-collapsed', String(next));
                return next;
              });
            }}
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            type="button"
          >
            <icons.pin aria-hidden="true" size={16} />
          </button>
        </div>
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
                    title={sidebarCollapsed ? item.label : undefined}
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
          {favorites.length > 0 && (
            <div className={styles.navGroup}>
              <span className={styles.navLabel}>Pinned Apps</span>
              <span aria-live="polite" className={styles.srOnly}>
                {favoriteOrderMessage}
              </span>
              {favorites.map((favorite, index) => (
                <div
                  className={styles.favoriteRow}
                  key={favorite.name}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const name = draggedFavorite.current ?? event.dataTransfer.getData('text/plain');
                    draggedFavorite.current = null;
                    if (name) void moveFavorite(name, index);
                  }}
                >
                  <a
                    className={styles.favoriteLink}
                    href={favorite.browserUrl ?? favorite.localUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={sidebarCollapsed ? favorite.displayName : undefined}
                  >
                    <span className={styles.iconWell}>
                      <ServiceLogo name={favorite.name} size={19} />
                    </span>
                    <span>{favorite.displayName}</span>
                  </a>
                  <button
                    aria-label={`Reorder ${favorite.displayName}. Use up and down arrow keys.`}
                    className={styles.dragHandle}
                    draggable
                    onDragEnd={() => {
                      draggedFavorite.current = null;
                    }}
                    onDragStart={(event) => {
                      draggedFavorite.current = favorite.name;
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', favorite.name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        void moveFavorite(favorite.name, index - 1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        void moveFavorite(favorite.name, index + 1);
                      }
                    }}
                    title="Drag to reorder"
                    type="button"
                  >
                    <icons.grip aria-hidden="true" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </nav>
        <Link className={styles.sidebarFooter} href="/system/status">
          <span className={styles.iconWell}>
            <icons.system aria-hidden="true" size={16} />
          </span>
          <span>
            <strong>Stackarr v{version}</strong>
            <small>{releaseChannelLabel(channel)}</small>
          </span>
        </Link>
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
                <span>{item.label}</span>
              </Link>
            );
          })}
      </nav>
    </div>
  );
}

function releaseChannelLabel(channel: string) {
  if (channel === 'stable') return 'Stable Release';
  if (channel === 'alpha') return 'Alpha Release';
  if (channel === 'beta') return 'Beta Release';
  return `${channel || 'Preview'} Release`;
}

function isNavItemActive(item: NavItem, pathname: string) {
  if (item.href === '/') return pathname === '/';
  if (item.href === '/activity/queue') return pathname.startsWith('/activity') || pathname === '/system/logs';
  if (item.href === '/agent') {
    return pathname.startsWith('/agent');
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
