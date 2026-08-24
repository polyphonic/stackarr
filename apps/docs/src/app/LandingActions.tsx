'use client';

import { icons, Link } from '@stackarr/ui';

const DownloadIcon = icons.download;
const RocketIcon = icons.play;
const ControlIcon = icons.container;

export function LandingActions() {
  return (
    <div className="actions">
      <Link
        className="heroButton primary"
        data-analytics-interest="agent_setup"
        data-analytics-interest-group="agent"
        data-analytics-interest-label="agent_setup"
        data-analytics-link="hero_actions"
        data-analytics-link-type="agent_setup"
        data-analytics-platform="docs"
        href="/docs/agent/agent-setup"
      >
        <RocketIcon aria-hidden="true" size={18} />
        Start with an agent
      </Link>
      <Link
        className="heroButton secondary"
        data-analytics-interest="mcp_plugins"
        data-analytics-interest-group="agent"
        data-analytics-interest-label="mcp_plugins"
        data-analytics-link="hero_actions"
        data-analytics-link-type="mcp_plugins"
        data-analytics-platform="docs"
        href="/docs/agent/mcp"
      >
        <ControlIcon aria-hidden="true" size={18} />
        See safety profiles
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
        Install Stackarr
      </Link>
    </div>
  );
}
