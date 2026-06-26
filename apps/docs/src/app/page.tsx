import { icons } from '@stackarr/ui';
import { absoluteUrl, githubRepo, githubUrl, siteDescription, siteName } from '~/lib/site';
import { LandingActions } from './LandingActions';

const BoxIcon = icons.container;
const BackupIcon = icons.backup;
const CloudIcon = icons.cloud;
const StarIcon = icons.star;

const services = [
  { name: 'Sonarr', logo: 'sonarr' },
  { name: 'Radarr', logo: 'radarr' },
  { name: 'Lidarr', logo: 'lidarr' },
  { name: 'Prowlarr', logo: 'prowlarr' },
  { name: 'Bazarr', logo: 'bazarr' },
  { name: 'Seerr', logo: 'overseerr' },
  { name: 'Jellyfin', logo: 'jellyfin' },
  { name: 'Docker', logo: 'docker' },
  { name: 'qBittorrent', logo: 'qbittorrent' },
  { name: 'Transmission', logo: 'transmission' },
  { name: 'Plex', logo: 'plex' },
  { name: 'Pulsarr', logo: 'pulsarr' },
  { name: 'BookOrbit', logo: 'bookorbit' },
  { name: 'TinyMediaManager', logo: 'tinymediamanager' },
  { name: 'Recyclarr', logo: 'recyclarr' },
  { name: 'FlareSolverr', logo: 'flaresolverr' },
  { name: 'Postgres', logo: 'postgres' },
  { name: 'Cloudflare', logo: 'cloudflare' }
];

const features = [
  {
    title: 'Setup with a co-pilot',
    icon: BoxIcon,
    copy: 'Let a trusted agent handle the repetitive wiring, checks, and setup steps while you stay in control of the choices that matter.'
  },
  {
    title: 'One media flow',
    icon: icons.download,
    copy: 'Bring movies, shows, music, books, subtitles, indexers, and request apps into a stack that feels designed to work together.'
  },
  {
    title: 'Rebuild-ready backups',
    icon: BackupIcon,
    copy: 'Protect the settings and app data that make the stack yours, so recovery is planned before anything breaks.'
  },
  {
    title: 'Private by default',
    icon: CloudIcon,
    copy: 'Start on your own machine, keep services local, and open only the access paths you decide to share.'
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
            <p className="eyebrow">0.3.0-alpha.1</p>
            <h1>Stackarr</h1>
            <p className="lede">
              Run a private media server stack with one polished control plane for requests, downloads, libraries,
              backups, books, and remote access.
            </p>
            <LandingActions />
            <p className="heroNote">
              Local-first by design. Stars help more self-hosters find the alpha while it is still young.
            </p>
          </div>
          <div className="serviceMap" aria-label="Managed services">
            {services.map((service, index) => (
              <span key={service.name} style={{ animationDelay: `${120 + index * 38}ms` }}>
                <img alt="" src={`/logos/${service.logo}.svg`} />
                <strong>{service.name}</strong>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="visualShowcase" aria-labelledby="visual-showcase-title" data-analytics-section="product_tour">
        <div className="sectionHeader">
          <p className="eyebrow">Product tour</p>
          <h2 id="visual-showcase-title">Your media stack, finally in one place</h2>
          <p>
            Stackarr turns the usual mix of tabs, config files, and one-off scripts into a focused control plane for
            running, tuning, and recovering your server.
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
          <p className="eyebrow">Start strong</p>
          <h2>Choose your launch path</h2>
        </div>
        <div className="tabs">
          <article>
            <h3>Guided setup</h3>
            <p>
              Pair Stackarr with a trusted coding agent and let it handle the repetitive setup work with your choices in
              the loop.
            </p>
            <pre>{`stackarr mcp serve
stackarr plugins install hermes`}</pre>
            <p>Built for local MCP clients including Codex, Claude, Hermes, and OpenClaw-style agents.</p>
          </article>
          <article>
            <h3>Docker stack</h3>
            <p>Spin up Stackarr with its managed services when you want the full home media stack in one launch.</p>
            <pre>{`docker pull polyphonic/stackarr:alpha
docker compose -f stackarr/docker-compose.yml --profile stackarr up -d stackarr`}</pre>
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
