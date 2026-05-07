import { beforeEach, describe, expect, it, vi } from "vitest";
import { runJobStreet } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return {
    ...actual,
    runJobStreet: vi.fn(),
  };
});

describe("jobstreet manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runJobStreet).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the jobstreet source", async () => {
    const { manifest } = await import("../src/manifest");

    expect(manifest.id).toBe("jobstreet");
    expect(manifest.displayName).toBe("JobStreet");
    expect(manifest.providesSources).toEqual(["jobstreet"]);
    expect(manifest.capabilities).toEqual({ locationEvidence: true });
  });

  it("does not call the runner outside Indonesia", async () => {
    const { manifest } = await import("../src/manifest");

    const result = await manifest.run({
      source: "jobstreet",
      selectedSources: ["jobstreet"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "malaysia",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runJobStreet).not.toHaveBeenCalled();
  });

  it("passes runtime controls into runJobStreet", async () => {
    const { manifest } = await import("../src/manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi
      .fn()
      .mockResolvedValue(["https://id.jobstreet.com/job/91889473"]);

    vi.mocked(runJobStreet).mockImplementationOnce(async (options) => {
      options.onProgress?.({
        type: "page_fetched",
        termIndex: 1,
        termTotal: 1,
        searchTerm: "backend engineer",
        location: "Jakarta",
        pageNo: 1,
        resultsOnPage: 2,
        totalCollected: 2,
      });
      return { success: true, jobs: [] };
    });

    await manifest.run({
      source: "jobstreet",
      selectedSources: ["jobstreet"],
      selectedCountry: "indonesia",
      searchTerms: ["backend engineer"],
      settings: {
        jobstreetMaxJobsPerTerm: "12",
        searchCities: "Jakarta",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runJobStreet).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["backend engineer"],
        locations: ["Jakarta"],
        existingJobUrls: ["https://id.jobstreet.com/job/91889473"],
        maxJobsPerTerm: 12,
        shouldCancel,
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "list",
        listPagesProcessed: 1,
        jobCardsFound: 2,
      }),
    );
  });

  it("falls back to the shared jobspy limit setting", async () => {
    const { manifest } = await import("../src/manifest");

    await manifest.run({
      source: "jobstreet",
      selectedSources: ["jobstreet"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {
        jobspyResultsWanted: "8",
      },
    });

    expect(runJobStreet).toHaveBeenCalledWith(
      expect.objectContaining({
        maxJobsPerTerm: 8,
      }),
    );
  });

  it("surfaces challenge-required failures", async () => {
    vi.mocked(runJobStreet).mockResolvedValueOnce({
      success: false,
      jobs: [],
      challengeRequired: "https://id.jobstreet.com/software-engineer-jobs",
    });

    const { manifest } = await import("../src/manifest");
    const result = await manifest.run({
      source: "jobstreet",
      selectedSources: ["jobstreet"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: undefined,
      challengeRequired: "https://id.jobstreet.com/software-engineer-jobs",
    });
  });
});
