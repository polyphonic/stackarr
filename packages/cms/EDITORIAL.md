# Stackarr blog editorial system

The blog is a public, Sanity-backed SEO surface for practical homelab guidance. It must remain useful without Stackarr.

## Topic boundary

Publish only material about self-hosting, homelabs, home servers, private cloud tools, media servers, smart-home infrastructure, personal data, game libraries, networking, storage, backups, containers, and safe automation.

Use community and publisher pages for topic discovery. Verify technical claims against current primary sources, official documentation, standards, release notes, or source repositories.

Do not:

- Copy a source headline or article structure.
- Reproduce source wording beyond short attributed quotations.
- Invent first-person experience.
- Turn a community post such as “I built my server” into a fake personal story.
- Publish general technology news without a clear homelab operation or decision.
- make unsupported security, privacy, performance, or compatibility claims.

## Product connection

Inspect the current Stackarr repository before each draft. Use shipped code and documentation as the source of truth.

A post may include one short “Where Stackarr fits” section when a verified feature directly helps. Keep the article complete for readers who do not use Stackarr. Add repository evidence paths to the draft. The publisher validates these paths and removes them before publication.

When new integrations, mobile apps, or automation features enter the repository, they become eligible topics only after their code or documentation exists.

## Image direction

Use a consistent 16:9 editorial system that differs from Hypo:

- Technical cutaway or system-diagram collage.
- Graphite and deep aubergine base.
- Electric violet signal lines.
- Fine grid, matte texture, and restrained depth.
- No people, readable text, fake application screenshots, or invented UI.
- Keep the central and upper-left areas clear enough for responsive crops.

The site generates Open Graph images dynamically. It adds the article title, category, Stackarr mark, and allowlisted local service logos. Do not fetch arbitrary remote SVG URLs at render time.

## Publication contract

1. Research recent posts and reject duplicate topics.
2. Create a temporary work directory outside the repository.
3. Save the draft JSON and reviewed cover image inside that directory.
4. Set `STACKARR_BLOG_WORK_DIR` to its absolute path.
5. Run `node packages/cms/scripts/article-draft.test.mjs` during publisher maintenance.
6. Run `node packages/cms/scripts/publish-article.mjs <draft.json>` with server-only Sanity credentials.
7. Verify tokenless Sanity visibility and the live article route.
8. Remove the complete temporary work directory.
