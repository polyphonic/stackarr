import { UserIcon } from '@sanity/icons';
import { defineField, defineType } from 'sanity';

export const author = defineType({
  name: 'author',
  title: 'Author',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({ name: 'name', type: 'string', validation: (rule) => rule.required() }),
    defineField({ name: 'role', type: 'string' }),
    defineField({ name: 'bio', type: 'text', rows: 4, validation: (rule) => rule.max(320) }),
    defineField({ name: 'url', type: 'url', validation: (rule) => rule.uri({ scheme: ['https'] }) })
  ]
});
