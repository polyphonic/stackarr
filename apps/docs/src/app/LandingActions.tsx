'use client';

import { icons, Link } from '@stackarr/ui';
import { githubRepo, githubUrl } from '~/lib/site';

const DownloadIcon = icons.download;
const RocketIcon = icons.play;
const StarIcon = icons.star;

export function LandingActions() {
  return (
    <div className="actions">
      <Link
        className="heroButton primary"
        data-analytics-interest="github_star"
        data-analytics-interest-group="oss"
        data-analytics-interest-label={githubRepo}
        data-analytics-link="hero_actions"
        data-analytics-link-type="github_star"
        data-analytics-platform="github"
        href={githubUrl}
        rel="noreferrer"
        target="_blank"
      >
        <StarIcon aria-hidden="true" size={18} />
        Star on GitHub
      </Link>
      <Link
        className="heroButton secondary"
        data-analytics-interest="install_docs"
        data-analytics-interest-group="install"
        data-analytics-interest-label="getting_started"
        data-analytics-link="hero_actions"
        data-analytics-link-type="install_docs"
        data-analytics-platform="docs"
        href="/docs/getting-started"
      >
        <RocketIcon aria-hidden="true" size={18} />
        Start Building
      </Link>
      <Link
        className="heroButton secondary"
        data-analytics-interest="download_section"
        data-analytics-interest-group="install"
        data-analytics-interest-label="download_section"
        data-analytics-link="hero_actions"
        data-analytics-link-type="download_section"
        data-analytics-platform="stackarr_site"
        href="#download"
      >
        <DownloadIcon aria-hidden="true" size={18} />
        Get Stackarr
      </Link>
    </div>
  );
}
