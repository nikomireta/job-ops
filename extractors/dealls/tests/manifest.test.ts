import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDealls } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return {
    ...actual,
    runDealls: vi.fn(),
  };
});

describe("dealls manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runDealls).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the dealls source", async () => {
    const { manifest } = await import("../src/manifest");

    expect(manifest.id).toBe("dealls");
    expect(manifest.displayName).toBe("Dealls");
    expect(manifest.providesSources).toEqual(["dealls"]);
    expect(manifest.capabilities).toEqual({ locationEvidence: true });
  });

  it("does not call the runner outside Indonesia", async () => {
    const { manifest } = await import("../src/manifest");

    const result = await manifest.run({
      source: "dealls",
      selectedSources: ["dealls"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "malaysia",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runDealls).not.toHaveBeenCalled();
  });

  it("passes runtime controls into runDealls", async () => {
    const { manifest } = await import("../src/manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi.fn().mockResolvedValue([sampleExistingUrl]);

    vi.mocked(runDealls).mockImplementationOnce(async (options) => {
      options.onProgress?.({
        type: "job_complete",
        termIndex: 1,
        termTotal: 1,
        searchTerm: "backend engineer",
        totalCollected: 1,
        jobUrl: sampleExistingUrl,
      });
      return { success: true, jobs: [] };
    });

    await manifest.run({
      source: "dealls",
      selectedSources: ["dealls"],
      selectedCountry: "indonesia",
      searchTerms: ["backend engineer"],
      settings: {
        deallsMaxJobsPerTerm: "12",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runDealls).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["backend engineer"],
        existingJobUrls: [sampleExistingUrl],
        maxJobsPerTerm: 12,
        shouldCancel,
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "job",
        jobPagesProcessed: 1,
        currentUrl: sampleExistingUrl,
      }),
    );
  });

  it("surfaces runner errors", async () => {
    vi.mocked(runDealls).mockResolvedValueOnce({
      success: false,
      jobs: [],
      error: "Dealls search request failed with HTTP 500",
    });

    const { manifest } = await import("../src/manifest");
    const result = await manifest.run({
      source: "dealls",
      selectedSources: ["dealls"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "Dealls search request failed with HTTP 500",
    });
  });
});

const sampleExistingUrl = "https://dealls.com/loker/software-engineer~acme";
