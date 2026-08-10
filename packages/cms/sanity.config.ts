import { visionTool } from '@sanity/vision';
import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { requirePublicSanityConfig } from './src/config';
import { schemaTypes } from './src/schemaTypes';

const { projectId, dataset } = requirePublicSanityConfig();

export default defineConfig({
  name: 'stackarr-blog',
  title: 'Stackarr Blog',
  projectId,
  dataset,
  basePath: '/studio',
  plugins: [structureTool(), visionTool()],
  schema: { types: schemaTypes }
});
