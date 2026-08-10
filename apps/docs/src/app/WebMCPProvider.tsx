'use client';

import { useEffect } from 'react';

type JsonSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
  };
  execute: (input?: Record<string, unknown>) => unknown | Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: {
      registerTool?: (tool: WebMCPTool, options?: Record<string, unknown>) => Promise<void>;
    };
  }

  interface Navigator {
    modelContext?: {
      provideContext?: (context: { tools: WebMCPTool[] } | WebMCPTool[]) => Promise<void> | void;
    };
  }
}

const docsByTopic: Record<string, string> = {
  overview: '/docs',
  installation: '/docs/installation',
  api: '/docs/api',
  authentication: '/docs/api/authentication',
  agent: '/docs/agent/mcp',
  plugins: '/docs/agent/plugins',
  safety: '/docs/agent/safety',
  tools: '/docs/agent/tools',
  security: '/docs/reference/security',
  backups: '/docs/operations/backups',
  troubleshooting: '/docs/operations/troubleshooting'
};

const blogCategories: Record<string, string> = {
  all: '/blog',
  infrastructure: '/blog/category/infrastructure-networking',
  entertainment: '/blog/category/media-entertainment',
  ai: '/blog/category/ai-automation',
  smartHome: '/blog/category/smart-home',
  data: '/blog/category/data-photos',
  gaming: '/blog/category/gaming-emulation'
};

function siteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

const tools: WebMCPTool[] = [
  {
    name: 'stackarr_get_agent_discovery',
    description: 'Return public Stackarr discovery URLs for docs, blog feeds, Auth.md, OpenAPI, MCP, and skills.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    },
    execute: () => ({
      auth: siteUrl('/auth.md'),
      openapi: siteUrl('/openapi.json'),
      apiCatalog: siteUrl('/.well-known/api-catalog'),
      mcpServerCard: siteUrl('/.well-known/mcp/server-card.json'),
      agentSkills: siteUrl('/.well-known/agent-skills/index.json'),
      llms: siteUrl('/llms.txt'),
      llmsFull: siteUrl('/llms-full.txt'),
      blog: siteUrl('/blog'),
      blogRss: siteUrl('/blog/feed.xml'),
      blogJsonFeed: siteUrl('/blog/feed.json'),
      blogSkill: siteUrl('/.well-known/agent-skills/stackarr-blog/SKILL.md')
    })
  },
  {
    name: 'stackarr_get_docs_url',
    description: 'Return the canonical Stackarr documentation URL for a known topic without changing page state.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: Object.keys(docsByTopic),
          description: 'Documentation topic to locate.'
        }
      },
      required: ['topic'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    },
    execute: (input) => {
      const topic = typeof input?.topic === 'string' ? input.topic : 'overview';
      const path = docsByTopic[topic] ?? docsByTopic.overview;

      return {
        topic,
        url: siteUrl(path)
      };
    }
  },
  {
    name: 'stackarr_get_blog_url',
    description: 'Return a Stackarr homelab blog index or category URL without changing page state.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: Object.keys(blogCategories),
          description: 'Blog category to locate. Use all for the complete index.'
        }
      },
      required: ['category'],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    },
    execute: (input) => {
      const category = typeof input?.category === 'string' ? input.category : 'all';
      const path = blogCategories[category] ?? blogCategories.all;

      return {
        category,
        url: siteUrl(path),
        rss: siteUrl('/blog/feed.xml'),
        jsonFeed: siteUrl('/blog/feed.json')
      };
    }
  }
];

let registration: Promise<void> | undefined;

function registerWebMCPTools() {
  registration ??= (async () => {
    if (document.modelContext?.registerTool) {
      await Promise.allSettled(tools.map((tool) => document.modelContext?.registerTool?.(tool)));
    }

    if (navigator.modelContext?.provideContext) {
      await Promise.resolve(navigator.modelContext.provideContext({ tools }));
    }
  })();

  return registration;
}

export function WebMCPProvider() {
  useEffect(() => {
    void registerWebMCPTools();
  }, []);

  return null;
}
