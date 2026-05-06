import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTechInAsia } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return {
    ...actual,
    runTechInAsia: vi.fn(),
  };
});

describe("techinasia manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runTechInAsia).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the techinasia source", async () => {
    const { manifest } = await import("../src/manifest");

    expect(manifest.id).toBe("techinasia");
    expect(manifest.displayName).toBe("Tech in Asia");
    expect(manifest.providesSources).toEqual(["techinasia"]);
    expect(manifest.capabilities).toEqual({ locationEvidence: true });
  });

  it("does not call the runner outside Indonesia", async () => {
    const { manifest } = await import("../src/manifest");

    const result = await manifest.run({
      source: "techinasia",
      selectedSources: ["techinasia"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "malaysia",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runTechInAsia).not.toHaveBeenCalled();
  });

  it("passes runtime controls into runTechInAsia", async () => {
    const { manifest } = await import("../src/manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi.fn().mockResolvedValue([sampleExistingUrl]);

    vi.mocked(runTechInAsia).mockImplementationOnce(async (options) => {
      options.onProgress?.({
        type: "page_fetched",
        termIndex: 1,
        termTotal: 1,
        searchTerm: "backend engineer",
        pageNo: 1,
        resultsOnPage: 2,
        totalCollected: 2,
      });
      return { success: true, jobs: [] };
    });

    await manifest.run({
      source: "techinasia",
      selectedSources: ["techinasia"],
      selectedCountry: "indonesia",
      searchTerms: ["backend engineer"],
      settings: {
        techinasiaMaxJobsPerTerm: "12",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runTechInAsia).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["backend engineer"],
        existingJobUrls: [sampleExistingUrl],
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
      source: "techinasia",
      selectedSources: ["techinasia"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {
        jobspyResultsWanted: "8",
      },
    });

    expect(runTechInAsia).toHaveBeenCalledWith(
      expect.objectContaining({
        maxJobsPerTerm: 8,
      }),
    );
  });

  it("surfaces runner errors", async () => {
    vi.mocked(runTechInAsia).mockResolvedValueOnce({
      success: false,
      jobs: [],
      error: "Tech in Asia search request failed with HTTP 500",
    });

    const { manifest } = await import("../src/manifest");
    const result = await manifest.run({
      source: "techinasia",
      selectedSources: ["techinasia"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "Tech in Asia search request failed with HTTP 500",
    });
  });
});

const sampleExistingUrl =
  "https://www.techinasia.com/jobs/5441069a-5114-4f87-9463-583234a808f3";
