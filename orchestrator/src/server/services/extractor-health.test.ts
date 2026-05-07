import type { ExtractorRegistry } from "@server/extractors/registry";
import type { ExtractorSourceId } from "@shared/extractors";
import type { ExtractorManifest } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetExtractorRegistry = vi.fn();

vi.mock("@server/extractors/registry", () => ({
  getExtractorRegistry: mockGetExtractorRegistry,
}));

function createRegistry(
  manifests: ExtractorManifest[],
  availableSources?: ExtractorSourceId[],
): ExtractorRegistry {
  const manifestBySource = new Map<ExtractorSourceId, ExtractorManifest>();

  for (const manifest of manifests) {
    for (const source of manifest.providesSources) {
      manifestBySource.set(source as ExtractorSourceId, manifest);
    }
  }

  return {
    manifests: new Map(manifests.map((manifest) => [manifest.id, manifest])),
    manifestBySource,
    availableSources:
      availableSources ?? Array.from(manifestBySource.keys()).sort(),
  };
}

describe("extractor health service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    const module = await import("./extractor-health");
    module.__resetExtractorHealthCacheForTests();
  });

  it("routes shared-manifest sources through the selected source and caches the result", async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      jobs: [
        {
          source: "linkedin",
          title: "Software Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/1",
        },
      ],
    });
    const manifest: ExtractorManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      capabilities: { locationEvidence: true },
      run,
    };
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([manifest]));

    const module = await import("./extractor-health");
    const first = await module.checkExtractorHealth("linkedin");
    const second = await module.checkExtractorHealth("linkedin");

    expect(first?.healthy).toBe(true);
    expect(first?.response.cached).toBe(false);
    expect(first?.response.capabilities?.locationEvidence).toBe(true);
    expect(second?.healthy).toBe(true);
    expect(second?.response.cached).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "linkedin",
        selectedSources: ["linkedin"],
        searchTerms: ["software"],
        selectedCountry: "united kingdom",
        settings: expect.objectContaining({
          jobspyCountryIndeed: "UK",
          jobspyResultsWanted: "1",
        }),
      }),
    );
  });

  it("uses Indonesia and the Dealls source limit for Dealls health probes", async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      jobs: [
        {
          source: "dealls",
          title: "Software Engineer",
          employer: "Acme",
          jobUrl: "https://dealls.com/loker/software-engineer~acme",
        },
      ],
    });
    const manifest: ExtractorManifest = {
      id: "dealls",
      displayName: "Dealls",
      providesSources: ["dealls"],
      run,
    };
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([manifest]));

    const module = await import("./extractor-health");
    const result = await module.checkExtractorHealth("dealls");

    expect(result?.healthy).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "dealls",
        selectedSources: ["dealls"],
        searchTerms: ["software"],
        selectedCountry: "indonesia",
        settings: expect.objectContaining({
          deallsMaxJobsPerTerm: "1",
        }),
      }),
    );
  });

  it("uses Indonesia and the Tech in Asia source limit for Tech in Asia health probes", async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      jobs: [
        {
          source: "techinasia",
          title: "Software Engineer",
          employer: "Acme",
          jobUrl:
            "https://www.techinasia.com/jobs/5441069a-5114-4f87-9463-583234a808f3",
        },
      ],
    });
    const manifest: ExtractorManifest = {
      id: "techinasia",
      displayName: "Tech in Asia",
      providesSources: ["techinasia"],
      run,
    };
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([manifest]));

    const module = await import("./extractor-health");
    const result = await module.checkExtractorHealth("techinasia");

    expect(result?.healthy).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "techinasia",
        selectedSources: ["techinasia"],
        searchTerms: ["software"],
        selectedCountry: "indonesia",
        settings: expect.objectContaining({
          techinasiaMaxJobsPerTerm: "1",
        }),
      }),
    );
  });

  it("uses Indonesia and the JobStreet source limit for JobStreet health probes", async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      jobs: [
        {
          source: "jobstreet",
          title: "Software Engineer",
          employer: "Acme",
          jobUrl: "https://id.jobstreet.com/job/91889473",
        },
      ],
    });
    const manifest: ExtractorManifest = {
      id: "jobstreet",
      displayName: "JobStreet",
      providesSources: ["jobstreet"],
      run,
    };
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([manifest]));

    const module = await import("./extractor-health");
    const result = await module.checkExtractorHealth("jobstreet");

    expect(result?.healthy).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "jobstreet",
        selectedSources: ["jobstreet"],
        searchTerms: ["software"],
        selectedCountry: "indonesia",
        settings: expect.objectContaining({
          jobstreetMaxJobsPerTerm: "1",
        }),
      }),
    );
  });

  it("expires cached results after one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));

    const run = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        jobs: [
          {
            source: "gradcracker",
            title: "Graduate Software Engineer",
            employer: "Beta",
            jobUrl: "https://example.com/jobs/grad-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        jobs: [
          {
            source: "gradcracker",
            title: "Graduate Developer",
            employer: "Gamma",
            jobUrl: "https://example.com/jobs/grad-2",
          },
        ],
      });
    const manifest: ExtractorManifest = {
      id: "gradcracker",
      displayName: "Gradcracker",
      providesSources: ["gradcracker"],
      run,
    };
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([manifest]));

    const module = await import("./extractor-health");
    const ttlMs = module.__getExtractorHealthCacheTtlMsForTests();

    const first = await module.checkExtractorHealth("gradcracker");
    vi.setSystemTime(new Date(Date.now() + ttlMs - 1));
    const cached = await module.checkExtractorHealth("gradcracker");
    vi.setSystemTime(new Date(Date.now() + 2));
    const refreshed = await module.checkExtractorHealth("gradcracker");

    expect(first?.response.cached).toBe(false);
    expect(cached?.response.cached).toBe(true);
    expect(refreshed?.response.cached).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns null when the source has no runtime manifest", async () => {
    mockGetExtractorRegistry.mockResolvedValue(createRegistry([]));

    const module = await import("./extractor-health");
    const result = await module.checkExtractorHealth("manual");

    expect(result).toBeNull();
  });
});
