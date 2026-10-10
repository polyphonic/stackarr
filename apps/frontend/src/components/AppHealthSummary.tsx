'use client';

import type { AppHealthSummary as AppHealthSummaryData } from '@stackarr/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import styles from './AppHealthSummary.module.css';
import { stackarrFetch } from './clientApi';
import { ServiceLogo } from './ServiceLogo';
import { Badge } from './ui';

export function useAppHealthSummary() {
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

  return { summary, loadFailed };
}

export function AppHealthSummary({
  children,
  emptyState,
  hasOtherIssues,
  summary,
  loadFailed
}: {
  children: ReactNode;
  emptyState: ReactNode;
  hasOtherIssues: boolean;
  summary: AppHealthSummaryData | null;
  loadFailed: boolean;
}) {
  // Unsupported authentication is neither an outage nor a verified green check.
  const visibleChecks =
    summary?.checks.filter(
      (check) => check.status === 'issues' || check.status === 'unavailable' || check.issues.length > 0
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
                          : 'Application-reported issues'}
                    </small>
                  </div>
                  <Badge tone={check.status === 'unavailable' || authFailed ? 'bad' : 'warn'}>
                    {check.status === 'unavailable'
                      ? 'offline'
                      : authFailed
                        ? 'auth failed'
                        : `${check.issues.length} ${check.issues.length === 1 ? 'issue' : 'issues'}`}
                  </Badge>
                </div>

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

/** Informational coverage is deliberately outside the Needs Attention panel. */
export function HealthCheckCoverage({ summary }: { summary: AppHealthSummaryData | null }) {
  if (!summary) return null;

  return (
    <details className={styles.coverage}>
      <summary>Health-check coverage · {summary.checks.length} apps</summary>
      <p>
        Checks report only what Stackarr could verify. A runtime or availability check does not verify every app feature
        or credential.
      </p>
      <div className={styles.coverageList}>
        {summary.checks.map((check) => (
          <div className={styles.coverageItem} key={check.service}>
            <strong>{check.displayName}</strong>
            <span>
              {check.status === 'unsupported'
                ? check.availability === 'reachable'
                  ? 'Reachable; authentication not verified'
                  : 'Health check not available'
                : check.status === 'unavailable'
                  ? 'Health check failed'
                  : check.status === 'issues'
                    ? 'Issues reported'
                    : check.scope === 'cli'
                      ? 'CLI readiness check passed'
                      : check.scope === 'container'
                        ? 'Container and CLI checks passed'
                        : check.authentication === 'verified'
                          ? 'Authenticated check passed'
                          : 'Application check passed'}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
