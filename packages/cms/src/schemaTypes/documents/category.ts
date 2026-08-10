import { TagIcon } from '@sanity/icons';
import { defineField, defineType } from 'sanity';

export const category = defineType({
  name: 'category',
  title: 'Category',
  type: 'document',
  icon: TagIcon,
  fields: [
    defineField({ name: 'title', type: 'string', validation: (rule) => rule.required() }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: { source: 'title', maxLength: 64 },
      validation: (rule) =>
        rule
          .required()
          .custom((value) =>
            value?.current && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.current)
              ? true
              : 'Use lowercase words separated by hyphens.'
          )
    }),
    defineField({ name: 'description', type: 'text', rows: 3, validation: (rule) => rule.required().max(220) }),
    defineField({ name: 'order', type: 'number', validation: (rule) => rule.required().integer().min(0) })
  ],
  orderings: [{ title: 'Menu order', name: 'menuOrder', by: [{ field: 'order', direction: 'asc' }] }]
});
