'use client';

import Script from 'next/script';

// Use the ESM Script import supported by both Next.js and vinext.
export function GoogleTagManager({ gtmId }: { gtmId: string }) {
  return (
    <>
      <Script
        id="_next-gtm-init"
        dangerouslySetInnerHTML={{
          __html:
            "window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});"
        }}
      />
      <Script id="_next-gtm" src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`} />
    </>
  );
}
