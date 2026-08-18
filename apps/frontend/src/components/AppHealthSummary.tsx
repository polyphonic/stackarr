'use client';

import type { AppHealthSummary as AppHealthSummaryData } from '@stackarr/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import styles from './AppHealthSummary.module.css';
import { stackarrFetch } from './clientApi';
import { ServiceLogo } from './ServiceLogo';
import { Badge } from './ui';

export function AppHealthSummary({
  children,
  emptyState,
  hasOtherIssues
}: {
  children: ReactNode;
  emptyState: ReactNode;
  hasOtherIssues: boolean;
}) {
  const [summary, setSummary] = useState<AppHealthSummaryData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void stackarrFetch('/api/v1/services/health', { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as AppHealthSummaryData | null;
        if (!response.ok || !body || !Array.isArray(body.checks)) {
          setLoadFailed(true);
          return;
        }
        setSummary(body);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const problemChecks =
    summary?.checks.filter((check) => check.status === 'issues' || check.status === 'unavailable') ?? [];
  const hasHealthIssues = problemChecks.length > 0;

  return (
    <div className={styles.stack}>
      {!summary && !loadFailed && (
        <div className={styles.loading} role="status">
          <span aria-hidden="true" />
          Checking app health…
        </div>
      )}
      {loadFailed && (
        <div className={styles.probeWarning}>
          <Badge tone="warn">Health unavailable</Badge>
          <span>Stackarr could not complete the app health scan.</span>
        </div>
      )}
      {hasHealthIssues && (
        <div className={styles.healthGroups}>
          {problemChecks.map((check) => (
            <section className={styles.healthGroup} key={check.service} aria-label={`${check.displayName} health`}>
              <div className={styles.healthHeader}>
                <ServiceLogo name={check.service} size={34} />
                <div>
                  <strong>{check.displayName}</strong>
                  <small>
                    {check.status === 'unavailable' ? 'Health endpoint unavailable' : 'Application-reported issues'}
                  </small>
                </div>
                <Badge tone={check.status === 'unavailable' ? 'bad' : 'warn'}>
                  {check.status === 'unavailable'
                    ? 'offline'
                    : `${check.issues.length} ${check.issues.length === 1 ? 'issue' : 'issues'}`}
                </Badge>
              </div>
              <div className={styles.issueList}>
                {check.issues.slice(0, 3).map((issue) => (
                  <div className={styles.issue} key={`${issue.source}:${issue.message}`}>
                    <span
                      className={issue.severity === 'error' ? styles.errorDot : styles.warningDot}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{issue.source}</strong>
                      <p>{issue.message}</p>
                    </div>
                  </div>
                ))}
                {check.issues.length > 3 && (
                  <small className={styles.more}>+{check.issues.length - 3} more issues</small>
                )}
              </div>
              <a className={styles.configureLink} href={`/stack/services?app=${encodeURIComponent(check.service)}`}>
                Review {check.displayName} settings ›
              </a>
            </section>
          ))}
        </div>
      )}
      {hasOtherIssues ? children : summary && !hasHealthIssues ? emptyState : null}
    </div>
  );
}
