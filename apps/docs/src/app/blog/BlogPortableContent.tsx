import { PortableText, type PortableTextComponents } from '@portabletext/react';

const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => <p>{children}</p>,
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
    h4: ({ children }) => <h4>{children}</h4>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>
  },
  list: {
    bullet: ({ children }) => <ul>{children}</ul>,
    number: ({ children }) => <ol>{children}</ol>
  },
  listItem: {
    bullet: ({ children }) => <li>{children}</li>,
    number: ({ children }) => <li>{children}</li>
  },
  marks: {
    link: ({ children, value }) => {
      const href = typeof value?.href === 'string' ? value.href : '#';
      const external = href.startsWith('http');
      return (
        <a href={href} rel={external ? 'noopener noreferrer' : undefined} target={external ? '_blank' : undefined}>
          {children}
        </a>
      );
    },
    code: ({ children }) => <code>{children}</code>
  },
  types: {
    callout: ({ value }) => (
      <aside className={`blogCallout blogCallout-${String(value.tone ?? 'info')}`}>
        {value.title ? <strong>{String(value.title)}</strong> : null}
        <p>{String(value.body ?? '')}</p>
      </aside>
    ),
    codeBlock: ({ value }) => (
      <figure className="blogCodeBlock">
        <figcaption>{String(value.language ?? 'text')}</figcaption>
        <pre>
          <code>{String(value.code ?? '')}</code>
        </pre>
      </figure>
    ),
    faq: ({ value }) => (
      <section className="blogFaq" aria-label="Frequently asked questions">
        <h2>Frequently asked questions</h2>
        {Array.isArray(value.items)
          ? value.items.map((item: Record<string, unknown>) => (
              <details key={String(item._key ?? item.question)}>
                <summary>{String(item.question ?? '')}</summary>
                <p>{String(item.answer ?? '')}</p>
              </details>
            ))
          : null}
      </section>
    ),
    image: ({ value }) =>
      typeof value.url === 'string' ? (
        <figure className="blogInlineImage">
          <img alt={String(value.alt ?? '')} src={value.url} />
          {value.caption ? <figcaption>{String(value.caption)}</figcaption> : null}
        </figure>
      ) : null
  }
};

export function BlogPortableContent({ value }: { value: Array<Record<string, unknown>> }) {
  return (
    <div className="blogProse">
      <PortableText components={components} value={value} />
    </div>
  );
}
