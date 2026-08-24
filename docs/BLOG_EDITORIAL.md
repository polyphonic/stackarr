# Stackarr blog editorial system

The blog is a public, Sanity-backed SEO surface for practical homelab guidance. Every article must remain useful without Stackarr.

## Topic boundary

Publish only material about self-hosting, homelabs, home servers, private cloud tools, media servers, smart-home infrastructure, personal data, game libraries, networking, storage, backups, containers, and safe automation.

Use community and publisher pages for topic discovery. Verify every technical claim against current primary sources, official documentation, standards, release notes, or source repositories.

Do not:

- Copy a source headline, wording, or article structure.
- Invent first-person experience.
- Turn a community post into a fake personal story.
- Publish general technology news without a clear homelab operation or decision.
- Make unsupported security, privacy, performance, or compatibility claims.
- Link to a Stackarr documentation page that does not contain the promised instructions.

## Actionable writing standard

Tutorial, security, and troubleshooting articles must tell the reader how to complete the task. Do not replace instructions with phrases such as “configure this securely,” “use best practices,” or “review your settings.”

Every actionable article must include:

1. A concrete outcome that describes what the reader will build or fix.
2. Prerequisites with required accounts, permissions, network facts, and compatibility limits.
3. At least four numbered setup steps with exact menu paths, fields, commands, or configuration values.
4. A verification section that tests both the allowed path and the denied path.
5. Troubleshooting or rollback instructions that return the system to a safe state.
6. At least 650 useful words and six H2 sections.
7. Between two and five inline figures that explain architecture, setup decisions, or verification.

Explain important compatibility limits. For example, browser-based identity gates can break native applications that cannot complete an interactive sign-in.

## Product relevance

Inspect the current Stackarr repository before each draft. Shipped code and current documentation are the source of truth.

A verified Stackarr feature may appear in one or two sentences inside the most relevant setup step. Keep the wording practical and optional. Explain the equivalent manual result for readers who do not use Stackarr.

Do not add a “Where Stackarr fits” heading, product callout, sales block, or closing promotion. Do not use Stackarr in any article heading. Add repository evidence paths and a relevant docs path to the draft as internal validation metadata. The website does not render this metadata.

When new integrations, mobile apps, or automation features enter the repository, they become eligible topics only after their code or documentation exists. Reinspect the repository on every run so the topic pool evolves with shipped features.

## Image direction

Use a consistent graphite, deep-aubergine, and electric-violet editorial system, but rotate the cover composition. Before prompting or drawing, review the four newest public covers and classify each as one of these lanes:

1. **Editorial scene**: a clear physical setting or object-led illustration, such as a rooftop antenna path, storage cabinet, home floor plan, server shelf, or device environment. This is the default lane.
2. **System cutaway**: a restrained technical illustration that shows parts or boundaries without turning the cover into a labeled flowchart.
3. **Diagram**: a route map, decision diagram, verification matrix, graph, or boxes-and-arrows composition. Use this only when the article genuinely needs it.

Do not use the Diagram lane for consecutive covers, and use it at most once within any four-post window. If the newest cover is a diagram, route map, graph, labeled matrix, or boxes-and-arrows composition, the next cover must use the Editorial scene lane. Prefer the earlier object-led and environmental cover style over repeated panels, nodes, graphs, or signal-flow boxes.

Keep graphite and deep aubergine as the base, with electric violet used as a signal rather than the whole composition. Fine grids, matte texture, and restrained depth are optional details, not a required template. Do not use people, fake application screenshots, invented UI, or unreadable generated text. Use reviewed official service marks from `apps/docs/public/logos` when the article references that service. Never fetch an arbitrary remote SVG at render time.

The cover uses a 16:9 crop. Inline figures may still use diagrams when they materially explain a procedure, but they should not force the cover into the same diagram style. Inline figures must be wide, legible, and useful at mobile width. Alt text must explain the information in each figure, not only its appearance.

## Inline image contract

The draft JSON contains an `inlineImages` array:

```json
{
  "inlineImages": [
    {
      "key": "access-route",
      "imagePath": "/absolute/temporary/path/access-route.png",
      "alt": "An approved request passes through an identity policy and tunnel to one private service.",
      "caption": "The public hostname never points directly to the home WAN address."
    }
  ]
}
```

Place each image once on its own Markdown line:

```text
{{image:access-route}}
```

Image files must stay inside `STACKARR_BLOG_WORK_DIR`. The guarded publisher validates every image before mutation, uploads all assets, creates Portable Text image blocks, verifies public visibility, and removes uploaded assets if publication fails.

## Automation boundary

The daily scheduler is an operations concern, not a GitHub Actions workflow. A trusted external agent reads this policy and `packages/cms/editorial.config.json`, researches current topics, creates the draft and reviewed images in a temporary directory, and invokes the guarded publisher once. CI never receives the Sanity editor token.

The publisher independently verifies public source URLs, official-source identity, originality against source text and existing titles, repository evidence, image signatures, image placement, and public Sanity visibility. It must reject publication before any mutation when a preflight check fails.

## Publication contract

1. Research recent topics and reject duplicates.
2. Reject categories used by either of the two most recent articles.
3. Read current Stackarr code and docs before choosing product relevance.
4. Create a temporary work directory outside the repository.
5. Save draft JSON, cover image, and inline images inside that directory.
6. Review each image for relevance, legibility, trademarks, and invented UI.
7. Set `STACKARR_BLOG_WORK_DIR` to the absolute temporary path.
8. Run `pnpm --filter @stackarr/cms test` during publisher maintenance.
9. Run `node packages/cms/scripts/prepare-article.mjs <draft.json> <preparation.json>` with server-only Sanity credentials. This validates the article, uploads reviewed assets, and writes bounded Sanity MCP payloads without creating or publishing a post.
10. Pass `createDocuments` from the preparation file to Sanity MCP `create_documents`, then pass `publishDocuments` to `publish_documents` exactly once.
11. Verify tokenless Sanity visibility and the live article route, including every inline image.
12. If MCP creation, publication, or verification fails, run `node packages/cms/scripts/cleanup-article.mjs <preparation.json>` once. It removes only the recorded draft, public post, and uploaded assets.
13. Remove the complete temporary work directory.
