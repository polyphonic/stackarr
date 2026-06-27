import { getServiceIntegration } from '~/lib/service-integrations';

export function ServiceIntegration({ slug }: { slug: string }) {
  const service = getServiceIntegration(slug);

  if (!service) {
    return null;
  }

  return (
    <article className="integrationPage">
      <header className="integrationHero">
        <img alt="" src={`/logos/${service.logo}.svg`} />
        <div>
          <p>{service.category}</p>
          <h1>{service.name}</h1>
          <span>{service.role}</span>
        </div>
      </header>

      <p className="integrationLead">{service.hero}</p>

      <section>
        <h2>What It Does</h2>
        <ul>
          {service.whatItDoes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="integrationStackarr">
        <h2>How Stackarr Fits</h2>
        <p>{service.stackarr}</p>
      </section>
    </article>
  );
}
