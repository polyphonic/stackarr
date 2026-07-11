# Product

## Register

product

## Users

Stackarr is for people who self-host apps at home and want one approachable way to understand and operate them. Some users work primarily from Codex, Claude, ChatGPT, Hermes, OpenClaw, LM Studio, or another chat surface. Others prefer a web or future mobile app. They may run a full media stack, one app such as Immich or RomM, or a broader collection of self-hosted services.

Users should not need to understand Docker Compose, app-specific API conventions, or the internal shape of an Arr stack to complete everyday tasks. Experienced users can reveal infrastructure and advanced settings when needed.

## Product Purpose

Stackarr is a chat-first homelab manager. It discovers the apps a user chose, exposes a small consistent set of native operations to trusted agents, and keeps a manual control surface available for intervention and direct use.

Success means a user can start with no apps, add one useful app, grow the homelab over time, and always understand what is installed, what depends on what, what an agent can do, and what happened. Media management is the first deep vertical, not the boundary of the product.

## Brand Personality

Calm, capable, and delightful. Stackarr should feel like a polished consumer product with the confidence of a serious operations tool. Language is direct and written for the person running the homelab, not for Stackarr's developers.

## Anti-references

- Dense Arr-family administration screens that expose implementation details before the user's task.
- Dashboards that assume Plex, movies, downloads, or a large stack is always present.
- Generic card grids with several routes to the same setting.
- Agent interfaces that expose a generic shell, hide consequences, or imply queued work is complete.
- Developer-facing labels such as control-plane internals, catalog mechanics, or configuration keys in everyday UI.
- Decorative glass effects that reduce contrast or obscure navigation and pinned apps.

## Design Principles

1. Installed apps define the product. Navigation, actions, settings, and empty states adapt to the apps the user actually chose.
2. One task has one obvious home. App configuration lives with the app; Stackarr-wide preferences live in Settings; runtime evidence lives in Activity; containers and networks live in Infrastructure.
3. Start small and grow naturally. Zero-app and one-app installations are first-class, and adding or removing apps remains available after onboarding.
4. Chat and manual control are peers. They share native operations, dependency rules, approvals, and the same activity trail.
5. Safe power is explicit. Read actions are easy, consequential changes explain impact and request confirmation, and users may deliberately grant complete control.
6. Media is the proving ground, homelab management is the destination. Product language and architecture must allow new self-hosted app families without another redesign.

## Accessibility & Inclusion

Target WCAG 2.2 AA for the web product and equivalent native accessibility for future mobile apps. Support keyboard navigation, visible focus, semantic labels, reduced motion, color-independent state communication, readable contrast, responsive layouts, and touch targets of at least 44 by 44 CSS pixels.
