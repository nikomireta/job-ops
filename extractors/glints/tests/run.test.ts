import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it, vi } from "vitest";
import {
  dedupeGlintsJobs,
  extractGlintsDetailFromFallback,
  extractGlintsDetailFromJsonLd,
  extractGlintsJobUrlsFromHrefs,
  extractGlintsSourceJobId,
  extractJsonLdJobPosting,
  makeGlintsSearchUrl,
  mapGlintsJobDetail,
  normalizeGlintsJobUrl,
  resolveGlintsMaxJobsPerTerm,
  runGlintsWithCollector,
} from "../src/run";

const glintsJobUrl =
  "https://glints.com/id/opportunities/jobs/software-engineer/f3e22085-cdae-4839-a3ca-5ef2c00d5565";

function createJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "glints",
    sourceJobId: "f3e22085-cdae-4839-a3ca-5ef2c00d5565",
    title: "Software Engineer",
    employer: "Glints",
    jobUrl: glintsJobUrl,
    ...overrides,
  };
}

describe("glints extractor mapping", () => {
  it("builds Indonesia search URLs", () => {
    const url = new URL(makeGlintsSearchUrl({ keyword: "software engineer" }));

    expect(url.origin).toBe("https://glints.com");
    expect(url.pathname).toBe("/id/opportunities/jobs/explore");
    expect(url.searchParams.get("countries")).toBe("id");
    expect(url.searchParams.get("keyword")).toBe("software engineer");
  });

  it("normalizes public job URLs and extracts source ids", () => {
    const noisy =
      "https://glints.com/id/opportunities/jobs/software-engineer/f3e22085-cdae-4839-a3ca-5ef2c00d5565?traceInfo=abc";

    expect(extractGlintsSourceJobId(noisy)).toBe(
      "f3e22085-cdae-4839-a3ca-5ef2c00d5565",
    );
    expect(normalizeGlintsJobUrl(noisy)).toBe(glintsJobUrl);
  });

  it("collects only Glints job detail links from hrefs", () => {
    expect(
      extractGlintsJobUrlsFromHrefs([
        "/id/opportunities/jobs/software-engineer/f3e22085-cdae-4839-a3ca-5ef2c00d5565",
        "/id/opportunities/jobs/explore?countries=id",
        "https://example.com/id/opportunities/jobs/software-engineer/f3e22085-cdae-4839-a3ca-5ef2c00d5565",
        "/id/en/opportunities/jobs/software-engineer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?traceInfo=1",
      ]),
    ).toEqual([
      glintsJobUrl,
      "https://glints.com/id/en/opportunities/jobs/software-engineer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
  });

  it("extracts JSON-LD JobPosting values and maps normalized jobs", () => {
    const posting = extractJsonLdJobPosting([
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "JobPosting",
            title: "Software Engineer",
            hiringOrganization: {
              name: "Glints",
              sameAs: "https://glints.com/id/companies/glints",
            },
            description: "<p>Build marketplace features.</p>",
            datePosted: "2026-05-01",
            validThrough: "2026-05-31",
            employmentType: ["FULL_TIME"],
            skills: ["TypeScript", "React"],
            baseSalary: {
              currency: "IDR",
              value: {
                minValue: 5000000,
                maxValue: 9000000,
                unitText: "MONTH",
              },
            },
            jobLocation: {
              address: {
                addressLocality: "Jakarta Selatan",
                addressRegion: "DKI Jakarta",
                addressCountry: "ID",
              },
            },
          },
        ],
      }),
    ]);

    expect(posting).not.toBeNull();
    const detail = extractGlintsDetailFromJsonLd(
      `${glintsJobUrl}?traceInfo=abc`,
      posting ?? {},
    );
    const mapped = mapGlintsJobDetail(detail);

    expect(mapped).toEqual(
      expect.objectContaining({
        source: "glints",
        sourceJobId: "f3e22085-cdae-4839-a3ca-5ef2c00d5565",
        title: "Software Engineer",
        employer: "Glints",
        employerUrl: "https://glints.com/id/companies/glints",
        jobUrl: glintsJobUrl,
        applicationLink: glintsJobUrl,
        salary: "IDR 5000000-9000000 / MONTH",
        location: "Jakarta Selatan, DKI Jakarta",
        datePosted: "2026-05-01T00:00:00.000Z",
        deadline: "2026-05-31T00:00:00.000Z",
        jobDescription: "Build marketplace features.",
        jobType: "FULL_TIME",
        skills: "TypeScript, React",
      }),
    );
    expect(mapped?.locationEvidence).toMatchObject({
      rawLocation: "Jakarta Selatan, DKI Jakarta",
      location: "Jakarta Selatan, DKI Jakarta, Indonesia",
      countryKey: "indonesia",
      country: "indonesia",
      source: "glints",
    });
  });

  it("falls back to page title and body text when JSON-LD is unavailable", () => {
    const mapped = mapGlintsJobDetail(
      extractGlintsDetailFromFallback({
        jobUrl: glintsJobUrl,
        pageTitle:
          "Lowongan Software Engineer di Glints, Jakarta Selatan | Glints",
        bodyText: "Software Engineer\nBuild reliable products.",
      }),
    );

    expect(mapped).toEqual(
      expect.objectContaining({
        title: "Software Engineer",
        employer: "Glints",
        jobDescription: "Software Engineer\nBuild reliable products.",
      }),
    );
  });

  it("dedupes by source id or URL and skips existing URLs", () => {
    const jobs = [
      createJob(),
      createJob({ jobUrl: `${glintsJobUrl}?traceInfo=copy` }),
      createJob({
        sourceJobId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        jobUrl:
          "https://glints.com/id/opportunities/jobs/backend-engineer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ];

    expect(
      dedupeGlintsJobs(jobs, [glintsJobUrl]).map((job) => job.jobUrl),
    ).toEqual([
      "https://glints.com/id/opportunities/jobs/backend-engineer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
  });

  it("resolves max jobs per term safely", () => {
    expect(resolveGlintsMaxJobsPerTerm("12")).toBe(12);
    expect(resolveGlintsMaxJobsPerTerm("bad")).toBe(50);
    expect(resolveGlintsMaxJobsPerTerm(-3)).toBe(1);
    expect(resolveGlintsMaxJobsPerTerm(2000)).toBe(1000);
  });
});

describe("runGlintsWithCollector", () => {
  it("passes resolved caps to the term collector", async () => {
    const collectTerm = vi.fn().mockResolvedValue({ jobs: [createJob()] });

    const result = await runGlintsWithCollector(
      { searchTerms: ["backend"], maxJobsPerTerm: 7 },
      collectTerm,
    );

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(collectTerm).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerm: "backend",
        maxJobsPerTerm: 7,
      }),
    );
  });

  it("surfaces challenge-required collector failures", async () => {
    const result = await runGlintsWithCollector(
      { searchTerms: ["software engineer"] },
      async () => ({
        jobs: [],
        challengeRequired:
          "https://glints.com/id/opportunities/jobs/explore?countries=id",
      }),
    );

    expect(result).toEqual({
      success: false,
      jobs: [],
      challengeRequired:
        "https://glints.com/id/opportunities/jobs/explore?countries=id",
    });
  });

  it("returns partial deduped jobs when cancelled between terms", async () => {
    let shouldCancel = false;
    const result = await runGlintsWithCollector(
      {
        searchTerms: ["one", "two"],
        shouldCancel: () => shouldCancel,
      },
      async () => {
        shouldCancel = true;
        return { jobs: [createJob()] };
      },
    );

    expect(result).toEqual({
      success: true,
      jobs: [createJob()],
    });
  });
});
