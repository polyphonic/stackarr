import editorialConfig from '../editorial.config.json';

export type EditorialCategory = (typeof editorialConfig.categories)[number];

export const editorialCategories = editorialConfig.categories;
export const editorialDiscoverySources = editorialConfig.discoverySources;
