import { getBlogPostBySlug } from '@stackarr/cms';
import { ImageResponse } from 'next/og';
import { getServiceIntegration } from '~/lib/service-integrations';
import { absoluteUrl } from '~/lib/site';

export const alt = 'Stackarr homelab field note';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  const services = (post?.referencedServices ?? [])
    .map((serviceSlug) => getServiceIntegration(serviceSlug))
    .filter((service) => Boolean(service))
    .slice(0, 4);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#17131d',
        color: '#f4f0f7',
        padding: '58px 64px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          inset: 0,
          opacity: 0.2,
          backgroundImage:
            'linear-gradient(rgba(172,116,255,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(172,116,255,.28) 1px, transparent 1px)',
          backgroundSize: '42px 42px'
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, fontWeight: 700 }}>
          <img alt="" height={54} src={absoluteUrl('/icon-512.png')} width={54} />
          Stackarr / Field Notes
        </div>
        <div style={{ color: '#b28aff', display: 'flex', fontSize: 18, letterSpacing: 3, textTransform: 'uppercase' }}>
          {post?.category?.title || 'Homelab systems'}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', zIndex: 2, maxWidth: 1050 }}>
        <div style={{ color: '#b28aff', display: 'flex', fontSize: 20, marginBottom: 22 }}>
          OPERATIONS BRIEF / {post?.contentKind?.toUpperCase() || 'GUIDE'}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: post?.title && post.title.length > 68 ? 56 : 68,
            fontWeight: 720,
            lineHeight: 1.05
          }}
        >
          {post?.title || 'Practical systems thinking for the self-hosted home.'}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {services.map((service) =>
            service ? (
              <div
                key={service.slug}
                style={{
                  width: 62,
                  height: 62,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(178,138,255,.45)',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,.06)'
                }}
              >
                <img
                  alt=""
                  height={38}
                  src={absoluteUrl(`/logos/${service.logo}.${service.logoExtension ?? 'svg'}`)}
                  width={38}
                />
              </div>
            ) : null
          )}
        </div>
        <div style={{ color: '#a49ca9', display: 'flex', fontSize: 18 }}>stackarr.app/blog/{slug}</div>
      </div>
    </div>,
    size
  );
}
