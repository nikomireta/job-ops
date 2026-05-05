---
id: glints
title: Glints Extractor
description: Indonesia-only Glints extraction through the public jobs marketplace.
sidebar_position: 12
---

## What it is

Original website: [Glints Indonesia](https://glints.com/id/en)

This extractor reads public job listings from Glints Indonesia's Explore page and enriches each listing from the public job detail page. It is scoped to Indonesia and does not log in or apply to jobs.

Implementation split:

1. `extractors/glints/src/run.ts` opens `https://glints.com/id/opportunities/jobs/explore?countries=id&keyword=...`, collects public job links, opens detail pages, parses JSON-LD `JobPosting` metadata when available, and maps results into `CreateJobInput`.
2. `extractors/glints/src/manifest.ts` enforces Indonesia-only runs, adapts pipeline settings, emits progress updates, and registers the source for runtime discovery.

## Why it exists

Glints is a strong local source for Indonesia roles and is especially useful for entry-level, early-career, and startup-heavy job discovery.

Adding it as a first-class extractor lets Indonesia-focused runs use the same JobOps discovery, scoring, duplicate detection, location filtering, and application tracking flow as other sources.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select **Indonesia** as the country.
3. Leave **Glints** enabled in **Sources** or toggle it on.
4. Enter search terms such as:
   ```text
   software engineer
   backend developer
   product manager
   ```
5. Start the run and monitor list-page and detail-page progress in the pipeline progress card.

Defaults and constraints:

- The extractor only runs when selected country is `indonesia`.
- `GLINTS_MAX_JOBS_PER_TERM` controls the default per-term cap when no automatic run budget override is present.
- The extractor does not require credentials and does not submit applications.
- Application links remain the Glints listing URL.
- City and workplace filtering are handled by JobOps location matching from extracted location evidence.
- Glints can show Cloudflare challenges; if headless browsing is blocked, JobOps pauses and asks for human challenge solving through the shared browser challenge flow.

## Common problems

### Glints does not run

- Confirm the selected country is Indonesia.
- Check that the app build includes `extractors/glints/src/manifest.ts` and the shared `glints` source metadata.

### Health check reports a challenge

- Glints may require a Cloudflare clearance cookie.
- Use the pipeline challenge prompt to solve the challenge once, then rerun the health check or pipeline.

### Job descriptions look sparse

- The extractor prefers JSON-LD `JobPosting` metadata.
- If Glints changes or omits JSON-LD, it falls back to visible page text so the job is still actionable.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
