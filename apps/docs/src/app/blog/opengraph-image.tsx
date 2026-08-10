import { ImageResponse } from 'next/og';
import { absoluteUrl } from '~/lib/site';

export const alt = 'Stackarr homelab field notes';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
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
        padding: '62px 68px',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, fontWeight: 700 }}>
        <img alt="" height={58} src={absoluteUrl('/icon-512.png')} width={58} />
        Stackarr
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 980 }}>
        <div style={{ color: '#b28aff', display: 'flex', fontSize: 21, letterSpacing: 4, marginBottom: 26 }}>
          HOMELAB FIELD NOTES
        </div>
        <div style={{ display: 'flex', fontSize: 78, fontWeight: 730, lineHeight: 1.02 }}>
          Operate the homelab you meant to build.
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a49ca9', fontSize: 20 }}>
        <span>Media / Infrastructure / AI / Data / Gaming</span>
        <span>stackarr.app/blog</span>
      </div>
    </div>,
    size
  );
}
