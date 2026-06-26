import type React from 'react';
import { icons } from './icons';
import styles from './ui.module.css';

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function Panel({
  title,
  children,
  action
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        {action}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function ActionGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.actionGrid}>{children}</div>;
}

export function Stat({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'purple';
}) {
  const toneClass = tone === 'purple' ? 'purple' : tone;
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <strong className={toneClass === 'neutral' ? '' : toneClass}>{value}</strong>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={`${styles.table} ${className || ''}`}>{children}</table>;
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'purple';
}) {
  const toneClass = tone === 'purple' ? 'purple' : tone;
  return <span className={`${styles.badge} ${styles[toneClass] || styles.neutral}`}>{children}</span>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className = ''
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const SearchIcon = icons.search;

  return (
    <div className={`${styles.searchContainer} ${className}`}>
      <SearchIcon aria-hidden="true" className={styles.searchIcon} size={13} />
      <input
        type="text"
        className={styles.searchInput}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
