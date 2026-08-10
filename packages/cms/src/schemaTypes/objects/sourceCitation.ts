import { defineField, defineType } from 'sanity';

export const sourceCitation = defineType({
  name: 'sourceCitation',
  title: 'Source citation',
  type: 'object',
  fields: [
    defineField({ name: 'title', type: 'string', validation: (rule) => rule.required() }),
    defineField({ name: 'publisher', type: 'string', validation: (rule) => rule.required() }),
    defineField({
      name: 'url',
      type: 'url',
      validation: (rule) => rule.required().uri({ scheme: ['https'] })
    }),
    defineField({
      name: 'kind',
      type: 'string',
      initialValue: 'primary',
      options: {
        layout: 'radio',
        list: [
          { title: 'Primary or official', value: 'primary' },
          { title: 'Independent reference', value: 'reference' },
          { title: 'Discovery only', value: 'discovery' }
        ]
      },
      validation: (rule) => rule.required()
    })
  ],
  preview: { select: { title: 'title', subtitle: 'publisher' } }
});
