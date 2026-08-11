import { DocumentTextIcon } from '@sanity/icons';
import { defineArrayMember, defineField, defineType } from 'sanity';

const SAFE_SERVICE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const post = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({ name: 'title', type: 'string', validation: (rule) => rule.required().max(85) }),
    defineField({
      name: 'slug',
      type: 'slug',
      description: 'Public article URL segment.',
      options: {
        source: 'title',
        maxLength: 96,
        isUnique: (value, context) => context.defaultIsUnique(value, context)
      },
      validation: (rule) =>
        rule
          .required()
          .custom((value) =>
            value?.current && SAFE_SERVICE_SLUG_RE.test(value.current)
              ? true
              : 'Use lowercase words separated by hyphens.'
          )
    }),
    defineField({ name: 'excerpt', type: 'text', rows: 3, validation: (rule) => rule.required().max(180) }),
    defineField({
      name: 'category',
      type: 'reference',
      to: [{ type: 'category' }],
      validation: (rule) => rule.required()
    }),
    defineField({
      name: 'coverImage',
      type: 'image',
      options: { hotspot: true },
      fields: [
        defineField({ name: 'alt', type: 'string', validation: (rule) => rule.required() }),
        defineField({ name: 'caption', type: 'string' })
      ],
      validation: (rule) => rule.required()
    }),
    defineField({
      name: 'publishedAt',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required()
    }),
    defineField({ name: 'updatedAt', type: 'datetime' }),
    defineField({ name: 'author', type: 'reference', to: [{ type: 'author' }], validation: (rule) => rule.required() }),
    defineField({
      name: 'contentKind',
      type: 'string',
      initialValue: 'explainer',
      options: {
        list: [
          { title: 'Explainer', value: 'explainer' },
          { title: 'Tutorial', value: 'tutorial' },
          { title: 'Checklist', value: 'checklist' },
          { title: 'Comparison', value: 'comparison' },
          { title: 'Troubleshooting', value: 'troubleshooting' },
          { title: 'Security guide', value: 'security' }
        ]
      },
      validation: (rule) => rule.required()
    }),
    defineField({
      name: 'tags',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: { layout: 'tags' },
      validation: (rule) => rule.required().min(2).max(8).unique()
    }),
    defineField({
      name: 'referencedServices',
      title: 'Referenced service slugs',
      description: 'Use the local Stackarr integration slug, such as plex, immich, romm, or cloudflare.',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'string',
          validation: (rule) =>
            rule.custom((value) =>
              !value || SAFE_SERVICE_SLUG_RE.test(value) ? true : 'Use a lowercase Stackarr service slug.'
            )
        })
      ],
      validation: (rule) => rule.max(5).unique()
    }),
    defineField({ name: 'body', type: 'portableText', validation: (rule) => rule.required().min(8) }),
    defineField({
      name: 'sources',
      type: 'array',
      of: [defineArrayMember({ type: 'sourceCitation' })],
      validation: (rule) => rule.required().min(3).max(12)
    }),
    defineField({
      name: 'productConnection',
      title: 'Verified product relevance',
      description: 'Internal validation metadata. Put any useful Stackarr reference naturally inside an article step.',
      type: 'object',
      fields: [
        defineField({ name: 'relevant', type: 'boolean', initialValue: false }),
        defineField({ name: 'featureName', type: 'string', hidden: ({ parent }) => !parent?.relevant }),
        defineField({ name: 'explanation', type: 'text', rows: 3, hidden: ({ parent }) => !parent?.relevant }),
        defineField({
          name: 'docsPath',
          type: 'string',
          description: 'A local path such as /docs/setup/network-access.',
          hidden: ({ parent }) => !parent?.relevant,
          validation: (rule) =>
            rule.custom((value) => (!value || value.startsWith('/docs/') ? true : 'Use a local /docs/ path.'))
        })
      ]
    }),
    defineField({ name: 'featured', type: 'boolean', initialValue: false }),
    defineField({ name: 'seo', type: 'seoMetadata' })
  ],
  preview: {
    select: { title: 'title', category: 'category.title', date: 'publishedAt', media: 'coverImage' },
    prepare({ title, category, date, media }) {
      return { title, media, subtitle: [category, date?.slice(0, 10)].filter(Boolean).join(' · ') };
    }
  },
  orderings: [{ title: 'Newest first', name: 'publishedAtDesc', by: [{ field: 'publishedAt', direction: 'desc' }] }]
});
