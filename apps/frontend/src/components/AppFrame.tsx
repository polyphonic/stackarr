'use client';

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
  readServiceFavorites,
  subscribeServiceFavorites,
  writeServiceFavorites
} from './serviceFavorites';
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
          .filter((item) => item.href !== '/settings')
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
      <div className={styles.titleGroup}>
        <div className={styles.pageTitle}>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        <FavoriteServiceLinks />
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

function FavoriteServiceLinks() {
  const pathname = usePathname();
  const [favorites, setFavorites] = useState(() => [] as ReturnType<typeof readServiceFavorites>);
  const [draggedName, setDraggedName] = useState<string | null>(null);
  const [dropName, setDropName] = useState<string | null>(null);
  const dragState = useRef<{
    name: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    targetName: string | null;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let active = true;
    loadServiceFavorites()
      .then((next) => {
        if (active) {
          setFavorites(next);
        }
      })
      .catch(() => {
        if (active) {
          setFavorites(readServiceFavorites());
        }
      });

    const unsubscribe = subscribeServiceFavorites(setFavorites);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (favorites.length === 0) {
    return null;
  }

  const canReorderFavorites = pathname.startsWith('/stack/services') && favorites.length > 1;

  function reorderFavorites(sourceName: string, targetName: string) {
    if (sourceName === targetName) {
      return;
    }

    const sourceIndex = favorites.findIndex((favorite) => favorite.name === sourceName);
    const targetIndex = favorites.findIndex((favorite) => favorite.name === targetName);

    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const previous = favorites;
    const next = [...favorites];
    const [moved] = next.splice(sourceIndex, 1);

    next.splice(targetIndex, 0, moved);
    setFavorites(next);

    writeServiceFavorites(next.map((favorite) => favorite.name)).catch(() => setFavorites(previous));
  }

  function startFavoriteDrag(favoriteName: string, event: React.PointerEvent<HTMLAnchorElement>) {
    if (!canReorderFavorites || event.button !== 0) {
      return;
    }

    dragState.current = {
      name: favoriteName,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      targetName: null
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveFavoriteDrag(event: React.PointerEvent<HTMLAnchorElement>) {
    const drag = dragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);

    if (!drag.moved && distance < 6) {
      return;
    }

    drag.moved = true;
    suppressClick.current = true;
    setDraggedName(drag.name);
    event.preventDefault();

    const targetName = favoriteNameAtPoint(event.clientX, event.clientY);

    drag.targetName = targetName && targetName !== drag.name ? targetName : null;
    setDropName(drag.targetName);
  }

  function endFavoriteDrag(event: React.PointerEvent<HTMLAnchorElement>) {
    const drag = dragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragState.current = null;
    setDraggedName(null);
    setDropName(null);

    if (drag.moved) {
      event.preventDefault();
      const targetName = drag.targetName ?? favoriteNameAtPoint(event.clientX, event.clientY);
      if (targetName && targetName !== drag.name) {
        reorderFavorites(drag.name, targetName);
      }
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  }

  function cancelFavoriteDrag(event: React.PointerEvent<HTMLAnchorElement>) {
    const drag = dragState.current;

    if (drag && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }

    dragState.current = null;
    setDraggedName(null);
    setDropName(null);
    suppressClick.current = false;
  }

  function favoriteNameAtPoint(x: number, y: number) {
    const links = Array.from(document.querySelectorAll<HTMLElement>('[data-favorite-name]'));

    for (const link of links) {
      const rect = link.getBoundingClientRect();

      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return link.dataset.favoriteName ?? null;
      }
    }

    return null;
  }

  return (
    <nav className={styles.favoriteActions} aria-label="Favorite services">
      <span className={styles.favoriteSeparator} aria-hidden="true">
        <icons.starSolid size={11} />
      </span>
      {favorites.map((favorite) => (
        <a
          key={favorite.name}
          aria-label={`Open ${favorite.displayName}`}
          className={`${styles.favoriteLink} ${canReorderFavorites ? styles.favoriteReorderable : ''} ${draggedName === favorite.name ? styles.favoriteDragging : ''} ${dropName === favorite.name ? styles.favoriteDropTarget : ''}`}
          data-favorite-name={favorite.name}
          draggable={false}
          href={favorite.browserUrl ?? favorite.localUrl}
          onClick={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onPointerCancel={cancelFavoriteDrag}
          onPointerDown={(event) => startFavoriteDrag(favorite.name, event)}
          onPointerMove={moveFavoriteDrag}
          onPointerUp={endFavoriteDrag}
          rel="noreferrer"
          target="_blank"
          title={favorite.displayName}
        >
          <ServiceLogo name={favorite.name} size={22} />
        </a>
      ))}
    </nav>
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
