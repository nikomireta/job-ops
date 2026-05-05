import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGlints } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return {
    ...actual,
    runGlints: vi.fn(),
  };
});

describe("glints manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runGlints).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the glints source", async () => {
    const { manifest } = await import("../src/manifest");

    expect(manifest.id).toBe("glints");
    expect(manifest.displayName).toBe("Glints");
    expect(manifest.providesSources).toEqual(["glints"]);
    expect(manifest.capabilities).toEqual({ locationEvidence: true });
  });

  it("does not call the runner outside Indonesia", async () => {
    const { manifest } = await import("../src/manifest");

    const result = await manifest.run({
      source: "glints",
      selectedSources: ["glints"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "malaysia",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runGlints).not.toHaveBeenCalled();
  });

  it("passes runtime controls into runGlints", async () => {
    const { manifest } = await import("../src/manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi
      .fn()
      .mockResolvedValue([
        "https://glints.com/id/opportunities/jobs/existing/f3e22085-cdae-4839-a3ca-5ef2c00d5565",
      ]);

    vi.mocked(runGlints).mockImplementationOnce(async (options) => {
      options.onProgress?.({
        type: "list_page",
        termIndex: 1,
        termTotal: 1,
        searchTerm: "backend engineer",
        pageNo: 1,
        totalLinks: 2,
      });
      return { success: true, jobs: [] };
    });

    await manifest.run({
      source: "glints",
      selectedSources: ["glints"],
      selectedCountry: "indonesia",
      searchTerms: ["backend engineer"],
      settings: {
        glintsMaxJobsPerTerm: "12",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runGlints).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["backend engineer"],
        existingJobUrls: [
          "https://glints.com/id/opportunities/jobs/existing/f3e22085-cdae-4839-a3ca-5ef2c00d5565",
        ],
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

  it("surfaces challenge-required failures", async () => {
    vi.mocked(runGlints).mockResolvedValueOnce({
      success: false,
      jobs: [],
      challengeRequired:
        "https://glints.com/id/opportunities/jobs/explore?countries=id",
    });

    const { manifest } = await import("../src/manifest");
    const result = await manifest.run({
      source: "glints",
      selectedSources: ["glints"],
      selectedCountry: "indonesia",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: undefined,
      challengeRequired:
        "https://glints.com/id/opportunities/jobs/explore?countries=id",
    });
  });
});
