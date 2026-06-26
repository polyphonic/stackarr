# GTM Import

Import `stackarr-gtm-import.json` into Google Tag Manager container `GTM-MZ5T4FZH`.

The docs site loads Google Tag Manager with container `GTM-MZ5T4FZH`.

## Import Steps

1. Open Google Tag Manager.
2. Select container `GTM-MZ5T4FZH`.
3. Go to `Admin` -> `Import Container`.
4. Choose `tools/gtm/stackarr-gtm-import.json`.
5. Select `Existing workspace` unless you want a separate review workspace.
6. Select `Merge`.
7. Select `Rename conflicting tags, triggers, and variables`.
8. Confirm the import.
9. Use `Preview` and load the docs site.
10. Verify `traffic_source` fires once per session, `link_click` fires for links, and `project_interest` fires for
    high-signal OSS, install, docs, agent, Docker, GitHub, and media-stack links.
11. Publish after preview looks correct.

## Imported GTM Items

- Tag: `GA4 - Configuration`
- Tag: `GA4 Event - link_click`
- Tag: `GA4 Event - traffic_source`
- Tag: `GA4 Event - project_interest`
- Trigger: `Initialization - All Pages`
- Trigger: `Custom - link_click`
- Trigger: `Custom - traffic_source`
- Trigger: `Custom - project_interest`
- Data Layer Variables for every parameter emitted by `apps/docs/src/app/analytics-tracker.tsx`

This import intentionally does not include ecommerce, purchase, lead, or checkout events. Stackarr is tracked as an OSS
discovery project with GitHub, Docker, installation docs, agent/MCP docs, and Servarr/media-server ecosystem interest as
the main signals.

## GA4 Custom Definitions

After GTM preview is working, register the reporting dimensions you care about in GA4:

- `traffic_channel`
- `traffic_source`
- `traffic_medium`
- `referrer_domain`
- `link_location`
- `link_type`
- `link_platform`
- `link_domain`
- `outbound`
- `interest_type`
- `interest_group`
- `interest_label`
- `link_position`
