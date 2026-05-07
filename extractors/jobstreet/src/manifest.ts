import { normalizeCountryKey } from "@shared/location-support.js";
import { resolveSearchCities } from "@shared/search-cities.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { resolveJobStreetMaxJobsPerTerm, runJobStreet } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  location?: string;
  pageNo?: number;
  resultsOnPage?: number;
  totalCollected?: number;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  const locationSuffix = event.location ? ` in ${event.location}` : "";

  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `JobStreet: term ${event.termIndex}/${event.termTotal} (${event.searchTerm}${locationSuffix})`,
    };
  }

  if (event.type === "page_fetched") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.pageNo ?? 0,
      jobCardsFound: event.totalCollected ?? 0,
      jobPagesEnqueued: event.totalCollected ?? 0,
      currentUrl: event.searchTerm,
      detail: `JobStreet: page ${event.pageNo ?? 0} for ${event.searchTerm}${locationSuffix} (${event.totalCollected ?? 0} collected)`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `JobStreet: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}${locationSuffix}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "jobstreet",
  displayName: "JobStreet",
  providesSources: ["jobstreet"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "indonesia") {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = resolveJobStreetMaxJobsPerTerm(
      context.settings.jobstreetMaxJobsPerTerm ??
        context.settings.jobspyResultsWanted,
    );
    const existingJobUrls = await context.getExistingJobUrls?.();

    const result = await runJobStreet({
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        single:
          context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      existingJobUrls,
      maxJobsPerTerm,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
        challengeRequired: result.challengeRequired,
      };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
