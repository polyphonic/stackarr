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

  // Unsupported authentication is neither an outage nor a verified green check.
  const visibleChecks =
    summary?.checks.filter(
      (check) => check.status === 'issues' || check.status === 'unavailable' || check.status === 'unsupported'
    ) ?? [];
  const hasHealthNotices = visibleChecks.length > 0;

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
      {hasHealthNotices && (
        <div className={styles.healthGroups}>
          {visibleChecks.map((check) => {
            const authFailed = check.authentication === 'failed';
            const authUnverified =
              check.status === 'unsupported' &&
              (check.authentication === 'notConfigured' || check.authentication === 'unsupported');
            return (
              <section className={styles.healthGroup} key={check.service} aria-label={`${check.displayName} health`}>
                <div className={styles.healthHeader}>
                  <ServiceLogo name={check.service} size={34} />
                  <div>
                    <strong>{check.displayName}</strong>
                    <small>
                      {check.status === 'unavailable'
                        ? 'Health endpoint unavailable'
                        : authFailed
                          ? 'Authentication failed'
                          : authUnverified
                            ? 'Reachable; authentication unverified'
                            : 'Application-reported issues'}
                    </small>
                  </div>
                  <Badge tone={check.status === 'unavailable' || authFailed ? 'bad' : 'warn'}>
                    {check.status === 'unavailable'
                      ? 'offline'
                      : authFailed
                        ? 'auth failed'
                        : authUnverified
                          ? 'unverified'
                          : check.status === 'unsupported'
                            ? 'unsupported'
                            : `${check.issues.length} ${check.issues.length === 1 ? 'issue' : 'issues'}`}
                  </Badge>
                </div>
                {authUnverified && (
                  <p className={styles.unverifiedNote}>
                    {check.authentication === 'notConfigured'
                      ? 'No supported authentication credential is configured for this health check.'
                      : 'This health check cannot verify authentication.'}
                  </p>
                )}
                {check.issues.length > 0 && (
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
                )}
                <a className={styles.configureLink} href={`/stack/services?app=${encodeURIComponent(check.service)}`}>
                  Review {check.displayName} settings ›
                </a>
              </section>
            );
          })}
        </div>
      )}
      {hasOtherIssues ? children : summary && !hasHealthNotices ? emptyState : null}
    </div>
  );
}
