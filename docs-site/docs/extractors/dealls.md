---
id: dealls
title: Dealls Extractor
description: Indonesia-only Dealls extraction through the public job board JSON API.
sidebar_position: 14
---

## What it is

Original website: [Dealls](https://dealls.com/)

This extractor reads public job listings from Dealls through the JSON API used by the public job board. It is scoped to Indonesia, does not log in, and does not submit applications.

Implementation split:

1. `extractors/dealls/src/run.ts` calls `https://api.sejutacita.id/v1/explore-job/job` with active published job filters, enriches each listing from `https://api.sejutacita.id/v1/job-portal/job/<id>`, filters returned jobs to Indonesia, and maps the payload into `CreateJobInput`.
2. `extractors/dealls/src/manifest.ts` enforces Indonesia-only runs, adapts pipeline settings, emits progress updates, and registers the source for runtime discovery.

## Why it exists

Dealls is a local Indonesia job board with startup, technology, operations, product, business, and early-career roles.

Adding it as a first-class extractor lets Indonesia-focused runs use JobOps discovery, scoring, duplicate detection, location filtering, and application tracking without credentials or browser automation.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select **Indonesia** as the country.
3. Leave **Dealls** enabled in **Sources** or toggle it on.
4. Enter search terms such as:
   ```text
   DevOps
   cloud engineer
   site reliability engineer
   software engineer
   backend engineer
   ```
5. Start the run and monitor list/detail progress in the pipeline progress card.

Defaults and constraints:

- The extractor only runs when selected country is `indonesia`.
- `DEALLS_MAX_JOBS_PER_TERM` controls the default per-term cap when no automatic run budget override is present.
- The default cap is `50`; accepted values are `1` through `1000`.
- The extractor does not require credentials and does not submit applications.
- `applicationLink` uses a valid Dealls `externalPlatformApplyUrl` when present, otherwise it remains the Dealls listing URL.
- City and workplace filtering are handled by JobOps location matching from extracted location evidence.
- Dealls search works best with role keywords. Very specific skill-stack terms such as `Cloud Infrastructure (AWS & Alibaba Cloud)` or `EC2` can return no jobs even when relevant roles exist.
- When an exact term has zero results on the first page, the extractor tries a small set of role-oriented fallback terms, such as `cloud engineer`, `DevOps`, or `site reliability engineer`.
- The runtime does not use Playwright in v1 because the public JSON endpoint already returns job, company, salary, location, work mode, skills, and date fields.

## Common problems

### Dealls does not run

- Confirm the selected country is Indonesia.
- Check that the app build includes `extractors/dealls/src/manifest.ts` and the shared `dealls` source metadata.

### Health check returns unhealthy

- Confirm the runtime container includes the Dealls extractor package and source directory.
- Check whether `api.sejutacita.id` is returning non-JSON, HTTP `403`, or another upstream error.
- Retry later if Dealls is temporarily rate limiting or changing its public API shape.

### The pipeline runs but imports zero Dealls jobs

- Use role keywords instead of long profile phrases or individual tools.
- Good terms for Indonesia tech roles include `DevOps`, `cloud engineer`, `site reliability engineer`, `software engineer`, and `backend engineer`.
- If the progress card says it is trying fallback terms, the original term was too specific for Dealls search and JobOps is probing broader role labels.

### Jobs from outside Indonesia are skipped

- This is expected. The extractor only keeps jobs whose Dealls `country.name` is Indonesia or whose country id is `102`.
- Broader city filtering is still handled centrally by JobOps after extraction.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
