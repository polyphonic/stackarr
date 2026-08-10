import { defineArrayMember, defineField, defineType } from 'sanity';

export const portableText = defineType({
  name: 'portableText',
  title: 'Article body',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        { title: 'Normal', value: 'normal' },
        { title: 'Heading 2', value: 'h2' },
        { title: 'Heading 3', value: 'h3' },
        { title: 'Heading 4', value: 'h4' },
        { title: 'Quote', value: 'blockquote' }
      ],
      lists: [
        { title: 'Bullet', value: 'bullet' },
        { title: 'Numbered', value: 'number' }
      ],
      marks: {
        decorators: [
          { title: 'Strong', value: 'strong' },
          { title: 'Emphasis', value: 'em' },
          { title: 'Code', value: 'code' }
        ],
        annotations: [
          defineArrayMember({
            name: 'link',
            title: 'Link',
            type: 'object',
            fields: [
              defineField({
                name: 'href',
                title: 'URL',
                type: 'url',
                validation: (rule) => rule.required().uri({ scheme: ['https', 'http', 'mailto'] })
              }),
              defineField({ name: 'blank', title: 'Open in a new tab', type: 'boolean', initialValue: true })
            ]
          })
        ]
      }
    }),
    defineArrayMember({
      name: 'callout',
      title: 'Callout',
      type: 'object',
      fields: [
        defineField({
          name: 'tone',
          type: 'string',
          initialValue: 'info',
          options: {
            layout: 'radio',
            list: [
              { title: 'Information', value: 'info' },
              { title: 'Warning', value: 'warning' },
              { title: 'Success', value: 'success' }
            ]
          },
          validation: (rule) => rule.required()
        }),
        defineField({ name: 'title', type: 'string' }),
        defineField({ name: 'body', type: 'text', rows: 4, validation: (rule) => rule.required() })
      ],
      preview: { select: { title: 'title', subtitle: 'body' } }
    }),
    defineArrayMember({
      name: 'codeBlock',
      title: 'Code block',
      type: 'object',
      fields: [
        defineField({ name: 'language', type: 'string', initialValue: 'bash' }),
        defineField({ name: 'code', type: 'text', rows: 10, validation: (rule) => rule.required() })
      ],
      preview: { select: { title: 'language', subtitle: 'code' } }
    }),
    defineArrayMember({
      name: 'faq',
      title: 'FAQ',
      type: 'object',
      fields: [
        defineField({
          name: 'items',
          type: 'array',
          of: [
            defineArrayMember({
              name: 'faqItem',
              type: 'object',
              fields: [
                defineField({ name: 'question', type: 'string', validation: (rule) => rule.required() }),
                defineField({ name: 'answer', type: 'text', rows: 4, validation: (rule) => rule.required() })
              ]
            })
          ],
          validation: (rule) => rule.required().min(2).max(8)
        })
      ]
    }),
    defineArrayMember({
      type: 'image',
      options: { hotspot: true },
      fields: [
        defineField({ name: 'alt', type: 'string', validation: (rule) => rule.required() }),
        defineField({ name: 'caption', type: 'string' })
      ]
    })
  ]
});
