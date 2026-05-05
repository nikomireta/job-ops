import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { resolveKalibrrMaxJobsPerTerm, runKalibrr } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  pageNo?: number;
  resultsOnPage?: number;
  totalCollected?: number;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Kalibrr: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
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
      detail: `Kalibrr: collected ${event.totalCollected ?? 0} jobs for ${event.searchTerm}`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Kalibrr: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "kalibrr",
  displayName: "Kalibrr",
  providesSources: ["kalibrr"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "indonesia") {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = resolveKalibrrMaxJobsPerTerm(
      context.settings.kalibrrMaxJobsPerTerm ??
        context.settings.jobspyResultsWanted,
    );
    const existingJobUrls = await context.getExistingJobUrls?.();

    const result = await runKalibrr({
      searchTerms: context.searchTerms,
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
      };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
