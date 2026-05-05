import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { resolveGlintsMaxJobsPerTerm, runGlints } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  pageNo?: number;
  totalLinks?: number;
  jobsProcessed?: number;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Glints: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  if (event.type === "list_page") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.pageNo ?? 0,
      jobCardsFound: event.totalLinks ?? 0,
      jobPagesEnqueued: event.totalLinks ?? 0,
      currentUrl: event.searchTerm,
      detail: `Glints: collected ${event.totalLinks ?? 0} listing links for ${event.searchTerm}`,
    };
  }

  if (event.type === "job_complete") {
    return {
      phase: "job",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      jobPagesProcessed: event.jobsProcessed ?? 0,
      jobPagesEnqueued: event.jobsFoundTerm ?? 0,
      currentUrl: event.searchTerm,
      detail: `Glints: enriched ${event.jobsProcessed ?? 0} job pages for ${event.searchTerm}`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Glints: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "glints",
  displayName: "Glints",
  providesSources: ["glints"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "indonesia") {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = resolveGlintsMaxJobsPerTerm(
      context.settings.glintsMaxJobsPerTerm ??
        context.settings.jobspyResultsWanted,
    );
    const existingJobUrls = await context.getExistingJobUrls?.();

    const result = await runGlints({
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
        challengeRequired: result.challengeRequired,
      };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
