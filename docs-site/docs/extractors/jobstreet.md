---
id: jobstreet
title: JobStreet Extractor
description: Indonesia-only JobStreet extraction through public search result pages.
sidebar_position: 16
---

## What it is

Original website: [JobStreet Indonesia](https://id.jobstreet.com/)

This extractor reads public job cards from JobStreet Indonesia search pages. It is scoped to Indonesia, does not store JobStreet credentials, and does not submit applications.

Implementation split:

1. `extractors/jobstreet/src/run.ts` opens `https://id.jobstreet.com/<term>-jobs` or `https://id.jobstreet.com/<term>-jobs/in-<city>`, collects public `/job/<id>` cards, maps visible card metadata into `CreateJobInput`, and handles Cloudflare challenges through the shared browser flow.
2. `extractors/jobstreet/src/manifest.ts` enforces Indonesia-only runs, adapts pipeline settings, emits progress updates, and registers the source for runtime discovery.

## Why it exists

JobStreet is one of the largest local job boards for Indonesia and often has roles that are not present on startup-focused boards.

Adding it as a first-class extractor lets Indonesia-focused runs use JobOps discovery, scoring, duplicate detection, location filtering, and application tracking without storing JobStreet login credentials.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select **Indonesia** as the country.
3. Leave **JobStreet** enabled in **Sources** or toggle it on.
4. Enter search terms such as:
   ```text
   software engineer
   backend developer
   cloud engineer
   data analyst
   ```
5. Optionally enter cities such as `Jakarta`, `Bandung`, or `Surabaya`.
6. Start the run and monitor list-page progress in the pipeline progress card.

Defaults and constraints:

- The extractor only runs when selected country is `indonesia`.
- `JOBSTREET_MAX_JOBS_PER_TERM` controls the default per-term cap when no automatic run budget override is present.
- The default cap is `50`; accepted values are `1` through `1000`.
- The extractor does not require credentials and does not submit applications.
- Application links remain the normalized JobStreet listing URL.
- City and workplace filtering are handled by JobOps location matching from extracted location evidence.
- JobStreet can show Cloudflare challenges; if headless browsing is blocked, JobOps pauses and asks for human challenge solving through the shared browser challenge flow.

## Common problems

### JobStreet does not run

- Confirm the selected country is Indonesia.
- Check that the app build includes `extractors/jobstreet/src/manifest.ts` and the shared `jobstreet` source metadata.

### Health check reports a challenge

- JobStreet may require a Cloudflare clearance cookie.
- Use the pipeline challenge prompt to solve the challenge once, then rerun the health check or pipeline.

### The pipeline imports zero JobStreet jobs

- Use role keywords instead of long profile phrases or individual tools.
- Good terms for Indonesia searches include `software engineer`, `backend developer`, `cloud engineer`, and `data analyst`.
- Confirm the selected city and workplace filters are not too narrow.

### Job descriptions look sparse

- The v1 extractor maps visible public search-card metadata.
- Full detail-page enrichment is intentionally left for a later version so v1 can run without storing JobStreet credentials.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
