import { icons } from '@stackarr/ui';
import { serviceIntegrations } from '~/lib/service-integrations';
import { absoluteUrl, githubRepo, githubUrl, siteDescription, siteName } from '~/lib/site';
import { LandingActions } from './LandingActions';
import { LandingCodeBlock } from './LandingCodeBlock';

const BoxIcon = icons.container;
const BackupIcon = icons.backup;
const CloudIcon = icons.cloud;
const StarIcon = icons.star;

const agentClients = ['Codex', 'Claude', 'Hermes', 'OpenClaw', 'LM Studio'];

const features = [
  {
    title: 'Chat-first control plane',
    icon: BoxIcon,
    copy: 'Inspect, configure, repair, and operate the stack from Codex, Claude, Hermes, OpenClaw, LM Studio, or another MCP client.'
  },
  {
    title: 'Native app actions',
    icon: icons.download,
    copy: 'Agents use typed Stackarr and app API actions instead of improvising shell commands against your containers.'
  },
  {
    title: 'Authority you choose',
    icon: BackupIcon,
    copy: 'Start read-only, allow routine management, unlock admin setup, or deliberately grant unrestricted autonomous control.'
  },
  {
    title: 'Never chat-only',
    icon: CloudIcon,
    copy: 'The dashboard, API, and CLI remain available whenever you want to inspect a plan, intervene, or work manually.'
  }
];

const showcaseScreens = [
  {
    title: 'Dashboard',
    slug: 'dashboard',
    copy: 'The first screen gives you the pulse of the stack: health, storage, resources, notifications, and the next move.'
  },
  {
    title: 'Stack services',
    slug: 'stack-services',
    copy: 'Browse the full lineup of media apps, download clients, request tools, databases, and support services without losing the thread.'
  },
  {
    title: 'UI settings',
    slug: 'settings-ui',
    copy: 'Tune the experience to your setup with theme, refresh, service-link, and onboarding preferences that stay with the app.'
  }
];

const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      name: siteName,
      url: absoluteUrl('/'),
      description: siteDescription,
      inLanguage: 'en'
    },
    {
      '@type': 'SoftwareApplication',
      name: siteName,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'macOS, Linux, Windows, Docker',
      url: absoluteUrl('/'),
      downloadUrl: absoluteUrl('/docs/installation'),
      description: siteDescription,
      image: absoluteUrl('/icon-512.png'),
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      },
      sameAs: [githubUrl]
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: absoluteUrl('/')
        }
      ]
    }
  ]
};

export default function LandingPage() {
  return (
    <main className="landingPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }} />
      <section className="hero" data-analytics-section="hero">
        <nav className="nav" data-analytics-section="site_nav">
          <a className="brand" href="/" aria-label="Stackarr homepage">
            <img alt="" src="/icon.svg" /> Stackarr
          </a>
          <span className="navLinks">
            <a href="/docs/agent/agent-setup">Agent setup</a>
            <a href="/docs">Docs</a>
            <a href="/docs/installation">Install</a>
            <a href={githubUrl} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <a
              className="navStar"
              data-analytics-interest="github_star"
              data-analytics-interest-group="oss"
              data-analytics-interest-label={githubRepo}
              data-analytics-link="site_nav"
              data-analytics-link-type="github_star"
              data-analytics-platform="github"
              href={githubUrl}
              rel="noreferrer"
              target="_blank"
            >
              Star
            </a>
          </span>
        </nav>
        <div className="heroGrid">
          <div>
            <p className="eyebrow">Agent-managed homelab control</p>
            <h1>Your homelab, managed from chat.</h1>
            <p className="lede">
              Stackarr gives trusted agents one typed, safety-controlled interface to your media apps, downloads,
              requests, backups, containers, and infrastructure.
            </p>
            <LandingActions />
            <p className="heroNote">
              Chat-first, never chat-only. Keep the dashboard and CLI, or grant an agent complete control when you
              choose.
            </p>
          </div>
          <div className="agentConsole" aria-label="Example Stackarr agent plan">
            <div className="agentConsoleTop">
              <span className="agentOnline">
                <i aria-hidden="true" /> Stackarr control plane
              </span>
              <span className="profileBadge">manage</span>
            </div>
            <div className="agentPrompt">
              <span>You</span>
              <p>Check the stack, fix what is safe, and ask before interrupting playback.</p>
            </div>
            <div className="agentPlan">
              <div className="agentPlanHeader">
                <span>Agent plan</span>
                <strong>3 actions</strong>
              </div>
              <ol>
                <li>
                  <span className="agentStep">01</span>
                  <span>
                    <strong>Inspect enabled services</strong>
                    <small>Stackarr + native app APIs</small>
                  </span>
                  <em>read</em>
                </li>
                <li>
                  <span className="agentStep">02</span>
                  <span>
                    <strong>Repair stalled download</strong>
                    <small>Allowed by manage profile</small>
                  </span>
                  <em>run</em>
                </li>
                <li>
                  <span className="agentStep">03</span>
                  <span>
                    <strong>Restart Plex</strong>
                    <small>Playback may be interrupted</small>
                  </span>
                  <em className="askState">ask</em>
                </li>
              </ol>
            </div>
            <div className="agentConnectedApps">
              <span>Tools selected from installed apps</span>
              <div>
                {serviceIntegrations.slice(0, 7).map((service) => (
                  <a href={`/docs/integrations/${service.slug}`} key={service.name} title={service.name}>
                    <img alt={service.name} src={`/logos/${service.logo}.svg`} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="agentPath" aria-labelledby="agent-path-title" data-analytics-section="agent_path">
        <div className="agentPathHeader">
          <div>
            <p className="eyebrow">The first way in</p>
            <h2 id="agent-path-title">Use the chat surface you already trust</h2>
          </div>
          <p>
            Every client reaches the same shared actions and safety policy. Stackarr trims the catalog to the apps you
            installed, so agents see useful tools instead of a wall of irrelevant commands.
          </p>
        </div>
        <div className="agentClientRail" aria-label="Supported agent clients">
          {agentClients.map((client) => (
            <span key={client}>{client}</span>
          ))}
          <span>Any stdio MCP client</span>
        </div>
        <ol className="agentSteps">
          <li>
            <span className="stepNumber">01</span>
            <h3>Connect once</h3>
            <p>Add Stackarr as a local MCP server, or install the native Hermes and OpenClaw plugin bundles.</p>
            <a href="/docs/agent/agent-setup">Open agent setup →</a>
          </li>
          <li>
            <span className="stepNumber">02</span>
            <h3>Choose authority</h3>
            <p>Use observe, manage, admin, or unrestricted. The launch profile—not the agent—sets the boundary.</p>
            <a href="/docs/agent/mcp">Compare MCP profiles →</a>
          </li>
          <li>
            <span className="stepNumber">03</span>
            <h3>Speak normally</h3>
            <p>Ask for an install, a health check, a media request, a repair, or a full stack migration.</p>
            <a href="/docs/agent/plugins">Install agent plugins →</a>
          </li>
        </ol>
      </section>

      <section className="visualShowcase" aria-labelledby="visual-showcase-title" data-analytics-section="product_tour">
        <div className="sectionHeader">
          <p className="eyebrow">Manual control, always available</p>
          <h2 id="visual-showcase-title">See what the agent sees. Take over any time.</h2>
          <p>
            The dashboard is an optional but complete operating surface for setup, status, activity, recovery, and
            direct service access. Agent and human actions share the same control plane.
          </p>
        </div>
        <div className="screenshotHeroCard">
          <ThemeShot
            slug="dashboard"
            alt="Stackarr dashboard showing service status, resource gauges, storage, and configured services"
          />
        </div>
        <div className="screenshotGrid">
          {showcaseScreens.slice(1).map((screen) => (
            <article key={screen.slug}>
              <ThemeShot slug={screen.slug} alt={`Stackarr ${screen.title} screen`} />
              <h3>{screen.title}</h3>
              <p>{screen.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band" id="download" data-analytics-section="download">
        <div className="sectionHeader">
          <p className="eyebrow">Run it, then hand over the keys you choose</p>
          <h2>One container. One agent connection.</h2>
        </div>
        <div className="tabs">
          <article>
            <h3>Agent connection</h3>
            <p>
              Start with routine management and approval prompts. Move to admin for setup, or unrestricted when you
              intentionally want full autonomy.
            </p>
            <LandingCodeBlock>{`codex mcp add stackarr \\
  --env STACKARR_MCP_PROFILE=manage \\
  -- stackarr mcp serve`}</LandingCodeBlock>
            <p>
              Hermes and OpenClaw users can use <a href="/docs/agent/plugins">native plugin bundles</a> instead.
            </p>
          </article>
          <article>
            <h3>Docker runtime</h3>
            <p>Spin up the control plane with its managed services, then connect from a host-side chat client.</p>
            <LandingCodeBlock>{`docker pull polyphonic/stackarr:alpha
docker compose -f stackarr/docker-compose.yml \\
  --profile stackarr up -d app`}</LandingCodeBlock>
          </article>
        </div>
      </section>

      <section className="featureGrid" data-analytics-section="features">
        {features.map((feature) => (
          <article key={feature.title}>
            <feature.icon aria-hidden="true" size={28} />
            <h3>{feature.title}</h3>
            <p>{feature.copy}</p>
          </article>
        ))}
      </section>

      <section className="starDrive" data-analytics-section="github_star">
        <div className="starDriveCopy">
          <p className="eyebrow">Open-source signal</p>
          <h2>Help Stackarr reach more self-hosters</h2>
          <p>
            GitHub stars are a small action with useful surface area: they improve discovery, give contributors a
            visible signal, and make release posts easier to trust.
          </p>
        </div>
        <a
          className="starCard"
          data-analytics-interest="github_star"
          data-analytics-interest-group="oss"
          data-analytics-interest-label={githubRepo}
          data-analytics-link="github_star"
          data-analytics-link-type="github_star"
          data-analytics-platform="github"
          href={githubUrl}
          rel="noreferrer"
          target="_blank"
        >
          <StarIcon aria-hidden="true" size={34} />
          <span>
            <strong>Star {githubRepo}</strong>
            <em>Then watch releases, share the docs, or open a focused issue when something is rough.</em>
          </span>
        </a>
      </section>
      <footer className="footer" data-analytics-section="footer">
        <span>Stackarr alpha</span>
        <a href="/docs">Docs</a>
        <a href={githubUrl} rel="noreferrer" target="_blank">
          GitHub
        </a>
      </footer>
    </main>
  );
}

function ThemeShot({ slug, alt }: { slug: string; alt: string }) {
  return (
    <span className="themeShot">
      <img className="themeShotLight" src={`/screenshots/stackarr-${slug}-light.png`} alt={alt} loading="lazy" />
      <img
        className="themeShotDark"
        src={`/screenshots/stackarr-${slug}-dark.png`}
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
    </span>
  );
}
