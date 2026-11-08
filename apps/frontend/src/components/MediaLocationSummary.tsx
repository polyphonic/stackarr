import styles from './MediaLocationSummary.module.css';

export function relativeMediaFolder(root: string, folder: string) {
  if (!root.startsWith('/') || !folder.startsWith('/')) return null;
  if ([root, folder].some((path) => path.split('/').some((part) => part === '.' || part === '..'))) return null;
  const parent = root.replace(/\/+$/, '') || '/';
  const child = folder.replace(/\/+$/, '') || '/';
  if (child === parent) return '.';
  return child.startsWith(`${parent === '/' ? '' : parent}/`)
    ? child.slice(parent.length === 1 ? 1 : parent.length + 1)
    : null;
}

export function MediaLocationSummary({
  media,
  downloads,
  scratch,
  appData,
  shared
}: {
  media: string;
  downloads: string;
  scratch?: string;
  appData?: string;
  shared: boolean;
}) {
  const downloadFolder = relativeMediaFolder(media, downloads);
  const scratchFolder = scratch ? relativeMediaFolder(media, scratch) : null;
  const rows = [
    { label: 'Movies', value: shared ? 'Movies' : 'Existing app paths' },
    { label: 'TV shows', value: shared ? 'TV Shows' : 'Existing app paths' },
    { label: 'Downloads', value: downloadFolder ?? downloads, separate: downloadFolder === null && !!downloads },
    ...(scratch
      ? [{ label: 'Transcode scratch', value: scratchFolder ?? scratch, separate: scratchFolder === null }]
      : [])
  ];
  return (
    <section className={styles.summary} aria-label="Media folder layout">
      <div className={styles.heading}>
        <strong>{shared ? 'Folders inside Media' : 'Current folder layout'}</strong>
        <span>
          {shared
            ? 'Movies and TV Shows are fixed folders in this layout. Edit Downloads above to change its location.'
            : 'Existing movie and TV paths stay unchanged. This preview does not change app libraries.'}
        </span>
      </div>
      {media ? (
        <dl className={styles.folders}>
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <code>{row.value || 'Choose a folder'}</code>
                {row.separate && <small>Outside Media</small>}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Choose a mounted folder to see the library layout.</p>
      )}
      {media && downloadFolder === null && downloads && (
        <p className={styles.notice}>
          Downloads are outside Media. If the folders are on different filesystems, imports must copy files and use
          extra space instead of hardlinking.
        </p>
      )}
      <p>
        For a software RAID mirror, choose its mounted logical volume, not an individual member disk. A mirror is not a
        backup.
      </p>
      {appData && (
        <div className={styles.appData}>
          <strong>
            {relativeMediaFolder(media, appData) === null ? 'App data stays separate' : 'App data location'}
          </strong>
          <code>{appData}</code>
          <span>Settings and databases can stay on an SSD while Media uses another volume.</span>
        </div>
      )}
      {shared && (
        <details>
          <summary>Advanced: paths inside Docker</summary>
          <p>
            The Media folder is mounted once at <code>/data</code>. Apps use <code>/data/Movies</code> and{' '}
            <code>/data/TV Shows</code>. This does not add a host folder. Same-mount layout allows fast imports when the
            filesystem, permissions and app support them.
          </p>
        </details>
      )}
    </section>
  );
}
