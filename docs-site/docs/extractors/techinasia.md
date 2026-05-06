---
id: techinasia
title: Tech in Asia Extractor
description: Indonesia-only Tech in Asia Jobs extraction through the public Algolia search index.
sidebar_position: 15
---

## What it is

Original website: [Tech in Asia Jobs](https://www.techinasia.com/jobs/search)

This extractor reads public job listings from Tech in Asia Jobs through the Algolia search endpoint used by the public jobs page. It is scoped to Indonesia, does not log in, and does not submit applications.

Implementation split:

1. `extractors/techinasia/src/run.ts` posts search requests to the public Algolia `job_postings` index, filters by `city.country_name:Indonesia`, paginates results, and maps each hit into `CreateJobInput`.
2. `extractors/techinasia/src/manifest.ts` enforces Indonesia-only runs, adapts pipeline settings, emits progress updates, and registers the source for runtime discovery.

## Why it exists

Tech in Asia Jobs is a useful source for Indonesia technology, startup, product, data, operations, marketing, and business roles.

Adding it as a first-class extractor lets Indonesia-focused runs use JobOps discovery, scoring, duplicate detection, location filtering, and application tracking without browser automation or credentials.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select **Indonesia** as the country.
3. Leave **Tech in Asia** enabled in **Sources** or toggle it on.
4. Enter search terms such as:
   ```text
   software engineer
   backend engineer
   cloud engineer
   DevOps
   data analyst
   ```
5. Start the run and monitor list-page progress in the pipeline progress card.

Defaults and constraints:

- The extractor only runs when selected country is `indonesia`.
- `TECHINASIA_MAX_JOBS_PER_TERM` controls the default per-term cap when no automatic run budget override is present.
- The default cap is `50`; accepted values are `1` through `1000`.
- The extractor does not require credentials and does not submit applications.
- `applicationLink` uses a valid Tech in Asia `external_link` when present, otherwise it remains the Tech in Asia listing URL.
- City and workplace filtering are handled by JobOps location matching from extracted location evidence.
- The runtime does not use Playwright in v1 because the public Algolia payload already returns job, company, salary, location, work mode, skills, dates, and description fields.
- `TECHINASIA_ALGOLIA_APP_ID`, `TECHINASIA_ALGOLIA_API_KEY`, and `TECHINASIA_ALGOLIA_INDEX` can override the public defaults if Tech in Asia rotates its public search configuration.

## Common problems

### Tech in Asia does not run

- Confirm the selected country is Indonesia.
- Check that the app build includes `extractors/techinasia/src/manifest.ts` and the shared `techinasia` source metadata.

### Health check returns unhealthy

- Confirm the runtime container includes the Tech in Asia extractor package and source directory.
- Check whether Algolia is returning HTTP `403`, HTTP `429`, or another upstream error.
- Retry later if Tech in Asia is temporarily rate limiting or changing its public index shape.

### The pipeline runs but imports zero Tech in Asia jobs

- Use role keywords instead of long profile phrases or individual tools.
- Good terms for Indonesia tech roles include `software engineer`, `backend engineer`, `cloud engineer`, `DevOps`, and `data analyst`.
- Confirm the selected workplace and city filters are not too narrow for the returned jobs.

### Jobs from outside Indonesia are skipped

- This is expected. The extractor only keeps jobs whose Tech in Asia city or company location country is Indonesia.
- Broader city filtering is still handled centrally by JobOps after extraction.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
