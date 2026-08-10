import { defineField, defineType } from 'sanity';

export const seoMetadata = defineType({
  name: 'seoMetadata',
  title: 'Search metadata',
  type: 'object',
  fields: [
    defineField({
      name: 'title',
      title: 'Meta title',
      type: 'string',
      validation: (rule) => rule.max(65).warning('Search titles usually work best below 65 characters.')
    }),
    defineField({
      name: 'description',
      title: 'Meta description',
      type: 'text',
      rows: 3,
      validation: (rule) => rule.max(160).warning('Search descriptions usually work best below 160 characters.')
    }),
    defineField({
      name: 'canonicalUrl',
      title: 'Canonical URL override',
      type: 'url',
      validation: (rule) => rule.uri({ scheme: ['https'] })
    }),
    defineField({ name: 'noIndex', title: 'Exclude from search', type: 'boolean', initialValue: false }),
    defineField({ name: 'openGraphTitle', title: 'Open Graph title', type: 'string' }),
    defineField({
      name: 'openGraphDescription',
      title: 'Open Graph description',
      type: 'text',
      rows: 3,
      validation: (rule) => rule.max(200)
    })
  ]
});
