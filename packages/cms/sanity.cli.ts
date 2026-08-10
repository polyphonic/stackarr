import { defineCliConfig } from 'sanity/cli';
import { requirePublicSanityConfig } from './src/config';

const { projectId, dataset } = requirePublicSanityConfig();

export default defineCliConfig({
  api: { projectId, dataset },
  autoUpdates: false
});
