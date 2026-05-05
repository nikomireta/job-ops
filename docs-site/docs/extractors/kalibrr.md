---
id: kalibrr
title: Kalibrr Extractor
description: Indonesia-only Kalibrr extraction through the public job board JSON endpoint.
sidebar_position: 13
---

## What it is

Original website: [Kalibrr Indonesia](https://www.kalibrr.com/id-ID/home)

This extractor reads public job listings from Kalibrr's Indonesia job board API. It is scoped to Indonesia, does not log in, and does not submit applications.

Implementation split:

1. `extractors/kalibrr/src/run.ts` calls `https://www.kalibrr.com/kjs/job_board/search?limit=15&offset=...&text=...`, filters returned jobs to `google_location.address_components.country === "Indonesia"`, and maps the payload into `CreateJobInput`.
2. `extractors/kalibrr/src/manifest.ts` enforces Indonesia-only runs, adapts pipeline settings, emits progress updates, and registers the source for runtime discovery.

## Why it exists

Kalibrr is a useful local board for Indonesia roles across technology, operations, marketing, and early-career hiring.

Adding it as a first-class extractor lets Indonesia-focused runs use the same JobOps discovery, scoring, duplicate detection, location filtering, and application tracking flow as other sources.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select **Indonesia** as the country.
3. Leave **Kalibrr** enabled in **Sources** or toggle it on.
4. Enter search terms such as:
   ```text
   software engineer
   backend developer
   product manager
   ```
5. Start the run and monitor page progress in the pipeline progress card.

Defaults and constraints:

- The extractor only runs when selected country is `indonesia`.
- `KALIBRR_MAX_JOBS_PER_TERM` controls the default per-term cap when no automatic run budget override is present.
- The default cap is `50`; accepted values are `1` through `1000`.
- The extractor does not require credentials and does not submit applications.
- `applicationLink` uses Kalibrr's valid `apply_redirect_url` when present, otherwise it remains the Kalibrr listing URL.
- City and workplace filtering are handled by JobOps location matching from extracted location evidence.
- The runtime does not use Playwright in v1 because the public JSON endpoint already returns title, company, description, qualifications, salary, location, work mode, skills, dates, and logo data.

## Common problems

### Kalibrr does not run

- Confirm the selected country is Indonesia.
- Check that the app build includes `extractors/kalibrr/src/manifest.ts` and the shared `kalibrr` source metadata.

### Health check returns unhealthy

- Confirm the runtime container includes the Kalibrr extractor package and source directory.
- Check whether the public Kalibrr endpoint is returning non-JSON, HTTP `403`, or another upstream error.
- Retry later if Kalibrr is temporarily rate limiting or changing its public API shape.

### Jobs from outside Indonesia are skipped

- This is expected. The extractor only keeps jobs whose Kalibrr `google_location.address_components.country` is Indonesia or `ID`.
- Broader city filtering is still handled centrally by JobOps after extraction.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
