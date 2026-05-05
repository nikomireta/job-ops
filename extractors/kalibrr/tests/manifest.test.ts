import { beforeEach, describe, expect, it, vi } from "vitest";
import { runKalibrr } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return {
    ...actual,
    runKalibrr: vi.fn(),
  };
});

describe("kalibrr manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runKalibrr).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the kalibrr source", async () => {
    const { manifest } = await import("../src/manifest");

    expect(manifest.id).toBe("kalibrr");
    expect(manifest.displayName).toBe("Kalibrr");
    expect(manifest.providesSources).toEqual(["kalibrr"]);
    expect(manifest.capabilities).toEqual({ locationEvidence: true });
  });

  it("does not call the runner outside Indonesia", async () => {
    const { manifest } = await import("../src/manifest");

    const result = await manifest.run({
      source: "kalibrr",
      selectedSources: ["kalibrr"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "malaysia",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runKalibrr).not.toHaveBeenCalled();
  });

  it("passes runtime controls into runKalibrr", async () => {
    const { manifest } = await import("../src/manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi.fn().mockResolvedValue([sampleExistingUrl]);

    vi.mocked(runKalibrr).mockImplementationOnce(async (options) => {
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
      source: "kalibrr",
      selectedSources: ["kalibrr"],
      selectedCountry: "indonesia",
      searchTerms: ["backend engineer"],
      settings: {
        kalibrrMaxJobsPerTerm: "12",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runKalibrr).toHaveBeenCalledWith(
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

  it("surfaces runner errors", async () => {
    vi.mocked(runKalibrr).mockResolvedValueOnce({
      success: false,
      jobs: [],
      error: "Kalibrr search request failed with HTTP 500",
    });

    const { manifest } = await import("../src/manifest");
    const result = await manifest.run({
      source: "kalibrr",
      selectedSources: ["kalibrr"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "Kalibrr search request failed with HTTP 500",
    });
  });
});

const sampleExistingUrl =
  "https://www.kalibrr.com/id-ID/c/acme/jobs/123/software-engineer";
