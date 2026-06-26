'use client';

import type { ServiceConfigModel } from '@stackarr/core';
import { useState } from 'react';
import { ServiceDirectory } from './ServiceDirectory';
import { StreamripDownloader } from './StreamripDownloader';

export function DownloadersDirectory({ configs }: { configs: ServiceConfigModel[] }) {
  const [streamripOpen, setStreamripOpen] = useState(false);

  return (
    <>
      <ServiceDirectory
        configs={configs}
        onServiceOpen={(config) => {
          if (config.service.name === 'streamrip') {
            setStreamripOpen(true);
            return true;
          }
          return false;
        }}
      />
      <StreamripDownloader open={streamripOpen} onClose={() => setStreamripOpen(false)} />
    </>
  );
}
