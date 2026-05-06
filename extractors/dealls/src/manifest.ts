import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { resolveDeallsMaxJobsPerTerm, runDealls } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  pageNo?: number;
  resultsOnPage?: number;
  totalCollected?: number;
  jobsFoundTerm?: number;
  jobUrl?: string;
  fallbackSearchTerms?: string[];
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Dealls: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
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
      detail: `Dealls: fetched page ${event.pageNo ?? 0} for ${event.searchTerm}`,
    };
  }

  if (event.type === "job_complete") {
    return {
      phase: "job",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      jobPagesProcessed: event.totalCollected ?? 0,
      currentUrl: event.jobUrl ?? event.searchTerm,
      detail: `Dealls: enriched ${event.totalCollected ?? 0} jobs for ${event.searchTerm}`,
    };
  }

  if (event.type === "term_fallback") {
    const fallbackLabel = (event.fallbackSearchTerms ?? [])
      .slice(0, 3)
      .join(", ");
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: fallbackLabel
        ? `Dealls: 0 results for ${event.searchTerm}; trying fallback ${fallbackLabel}`
        : `Dealls: 0 results for ${event.searchTerm}; trying fallback terms`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Dealls: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "dealls",
  displayName: "Dealls",
  providesSources: ["dealls"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "indonesia") {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = resolveDeallsMaxJobsPerTerm(
      context.settings.deallsMaxJobsPerTerm ??
        context.settings.jobspyResultsWanted,
    );
    const existingJobUrls = await context.getExistingJobUrls?.();

    const result = await runDealls({
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
