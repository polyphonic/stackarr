import { editorialCategories } from '@stackarr/cms';
import { icons } from '@stackarr/ui';
import { serviceIntegrations } from '~/lib/service-integrations';
import { absoluteUrl, githubUrl, siteDescription, siteName } from '~/lib/site';
import { BlogMenu } from './BlogMenu';
import { LandingActions } from './LandingActions';
import { LandingCodeBlock } from './LandingCodeBlock';

const BoxIcon = icons.container;
const BackupIcon = icons.backup;
const CloudIcon = icons.cloud;

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
    copy: 'The first screen gives you the pulse of the stack: active work, running containers, live performance, and the next move.'
  },
  {
    title: 'Apps',
    slug: 'stack-services',
    copy: 'Open the apps you installed, pin the ones you use most, and keep each connection and behavior setting close to its app.'
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
      operatingSystem: 'Docker',
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
            <BlogMenu categories={editorialCategories} description="Practical field notes for self-hosted systems." />
          </span>
        </nav>
        <div className="heroGrid">
          <div>
            <p className="eyebrow">Agent-managed homelab control</p>
            <h1>Your homelab, managed from chat.</h1>
            <p className="lede">
              Stackarr gives trusted agents one typed, safety-controlled interface to your self-hosted apps, backups,
              containers, downloads, and infrastructure.
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
                {serviceIntegrations
                  .filter((service) =>
                    ['plex', 'radarr', 'sonarr', 'agregarr', 'pulsarr', 'tracearr', 'immich'].includes(service.slug)
                  )
                  .map((service) => (
                    <a href={`/docs/integrations/${service.slug}`} key={service.name} title={service.name}>
                      <img alt={service.name} src={`/logos/${service.logo}.${service.logoExtension ?? 'svg'}`} />
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
            <p>Add Stackarr as a local MCP server, including native MCP connections for Hermes and OpenClaw.</p>
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
            <a href="/docs/agent/plugins">Connect Hermes or OpenClaw →</a>
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
            alt="Stackarr dashboard showing active work, running containers, and live CPU and memory history"
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
          <h2>Install once. Connect anywhere.</h2>
        </div>
        <div className="tabs">
          <article>
            <h3>1. Start Stackarr</h3>
            <p>Download the Compose file and run the control plane on any Docker-compatible host.</p>
            <LandingCodeBlock>{`curl -fsSL https://stackarr.app/docker-compose.yml -o docker-compose.yml
docker compose --profile stackarr up -d app`}</LandingCodeBlock>
          </article>
          <article>
            <h3>2. Connect your assistant</h3>
            <p>Start with approval-backed management, use admin for setup, or deliberately grant full autonomy.</p>
            <LandingCodeBlock>{`codex mcp add stackarr -- \\
  docker exec -i -e STACKARR_MCP_PROFILE=manage \\
  app /app/bin/stackarr mcp serve`}</LandingCodeBlock>
            <p>
              See the <a href="/docs/agent/mcp">MCP connection guides</a> for Claude, Hermes, OpenClaw, and LM Studio.
            </p>
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

      <footer className="footer" data-analytics-section="footer">
        <span>Stackarr</span>
        <a href="/blog">Blog</a>
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
