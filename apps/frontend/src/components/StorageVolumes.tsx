'use client';

import type { StackMetrics } from '@stackarr/core';
import { diskUsageKey } from '@stackarr/core/diskUsageIdentity';
import { formatBinaryBytes } from '../lib/formatBinaryBytes';
import styles from './StorageVolumes.module.css';

type Disk = StackMetrics['disks'][number];

const reasons: Record<string, string> = {
  'not-enrolled': 'Path is not enrolled for capacity reporting',
  missing: 'Path does not exist',
  unmounted: 'Expected volume is not mounted',
  'stale-identity': 'Volume identity changed',
  'permission-denied': 'Host access denied',
  'probe-unavailable': 'Host capacity probe unavailable',
  'guard-unavailable': 'Storage guard unavailable',
  'invalid-proof': 'Host proof invalid'
};

const compare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

export function StorageVolumes({ disks }: { disks: Disk[] }) {
  if (!disks.length) return <p>No storage paths configured yet.</p>;
  return (
    <div className={styles.volumes}>
      {disks.map((disk) => {
        const locations = new Set(disk.paths).size;
        const measured = disk.totalSpace !== null && disk.freeSpace !== null;
        const usagePercent =
          measured && disk.totalSpace! > 0
            ? Math.max(0, Math.min(100, ((disk.totalSpace! - disk.freeSpace!) / disk.totalSpace!) * 100))
            : null;
        const associations = [...(disk.associations ?? [])].sort(
          (a, b) =>
            compare(a.displayName ?? a.service, b.displayName ?? b.service) ||
            compare(a.path, b.path) ||
            compare(a.reason, b.reason) ||
            compare(a.source, b.source) ||
            compare(a.service, b.service) ||
            compare(a.status, b.status)
        );
        // Include path identity: equal display labels do not imply the same physical volume.
        const key = diskUsageKey(disk);
        return (
          <details key={key} className={styles.volume}>
            <summary className={styles.trigger}>
              <span className={styles.heading}>
                <strong>{disk.label.replace(/^\/Volumes\/(?=[^/])/, '')}</strong>
                <span>
                  {measured
                    ? `${formatBinaryBytes(disk.totalSpace! - disk.freeSpace!)} used of ${formatBinaryBytes(disk.totalSpace!)} · ${formatBinaryBytes(disk.freeSpace!)} free`
                    : 'Capacity unavailable'}{' '}
                  · {locations} {locations === 1 ? 'location' : 'locations'}
                  {usagePercent !== null && ` · ${Math.round(usagePercent)}% used`}
                </span>
                <span className={styles.usageTrack} data-unknown={usagePercent === null} aria-hidden="true">
                  {usagePercent !== null && <span className={styles.usageFill} style={{ width: `${usagePercent}%` }} />}
                </span>
              </span>
              <span className={styles.indicator} aria-hidden="true">
                ⌄
              </span>
            </summary>
            <ul className={styles.locations}>
              {associations.length
                ? associations.map((item) => (
                    <li key={JSON.stringify([item.service, item.path, item.reason, item.source])}>
                      <div className={styles.locationTitle}>
                        <strong>{item.displayName ?? item.service}</strong>
                        <span className={item.status === 'available' ? styles.available : styles.unavailable}>
                          {item.status === 'available' ? 'Available' : 'Unavailable'}
                        </span>
                      </div>
                      <span>{item.reason}</span>
                      <code>{item.path}</code>
                      {item.status !== 'available' && (
                        <span className={styles.reason}>{reasons[item.status] ?? item.status}</span>
                      )}
                    </li>
                  ))
                : [...new Set(disk.paths)].sort(compare).map((location) => (
                    <li key={location}>
                      <code>{location}</code>
                      <span className={disk.status === 'available' ? styles.available : styles.unavailable}>
                        {disk.status === 'available' ? 'Available' : 'Unavailable'}
                      </span>
                      {disk.status !== 'available' && (
                        <span className={styles.reason}>{reasons[disk.status ?? 'probe-unavailable']}</span>
                      )}
                    </li>
                  ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
