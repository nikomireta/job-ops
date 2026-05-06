import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeallsJobUrl,
  dedupeDeallsJobs,
  deriveDeallsFallbackSearchTerms,
  getDeallsSearchHeaders,
  isIndonesiaDeallsJob,
  makeDeallsRefererUrl,
  makeDeallsSearchUrl,
  mapDeallsJob,
  normalizeDeallsJobUrl,
  parseDeallsDetailPayload,
  parseDeallsSearchPayload,
  resolveDeallsMaxJobsPerTerm,
  runDeallsWithFetcher,
} from "../src/run";

const sampleJobUrl = "https://dealls.com/loker/software-engineer~acme";

function createDeallsJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "job-123",
    slug: "software-engineer",
    role: "Software Engineer",
    employmentTypes: ["full_time"],
    workplaceType: "hybrid",
    publishedAt: "2026-05-01T10:00:00.000Z",
    salaryType: "monthly",
    salaryCurrency: "IDR",
    salaryRange: {
      start: 8_000_000,
      end: 12_000_000,
    },
    country: {
      id: 102,
      name: "Indonesia",
    },
    city: {
      id: 158,
      name: "Jakarta Selatan",
    },
    company: {
      name: "Acme",
      slug: "acme",
      logoUrl: "https://cdn.example/logo.png",
      sector: "Technology",
      website: "https://acme.example",
      description: "Builds useful tools.",
    },
    skills: [{ name: "TypeScript" }, { name: "React" }, { name: "React" }],
    externalPlatformApplyUrl: "https://apply.example/job-123",
    ...overrides,
  };
}

function createDeallsDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "job-123",
    slug: "software-engineer",
    role: "Senior Software Engineer",
    responsibilities: ["<p>Build reliable products.</p>"],
    requirements: ["TypeScript", "Testing"],
    perks: ["Remote allowance"],
    workplaceType: "remote",
    company: {
      name: "Acme Indonesia",
      slug: "acme",
      logoUrl: "https://cdn.example/detail-logo.png",
      sector: "Technology",
      website: "https://acme.example",
      description: "Builds useful tools in Indonesia.",
    },
    ...overrides,
  };
}

function createJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "dealls",
    sourceJobId: "job-123",
    title: "Software Engineer",
    employer: "Acme",
    jobUrl: sampleJobUrl,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("dealls extractor mapping", () => {
  it("builds search URLs and browser-like headers", () => {
    const url = new URL(
      makeDeallsSearchUrl({
        keyword: "software engineer",
        page: 2,
        limit: 18,
      }),
    );

    expect(url.origin).toBe("https://api.sejutacita.id");
    expect(url.pathname).toBe("/v1/explore-job/job");
    expect(url.searchParams.get("published")).toBe("true");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("sortParam")).toBe("mostRelevant");
    expect(url.searchParams.get("sortBy")).toBe("asc");
    expect(url.searchParams.get("externalPlatformApplyUrlSet")).toBe("null");
    expect(url.searchParams.get("boostTheBoostedJob")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("18");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("search")).toBe("software engineer");
    expect(makeDeallsRefererUrl("software engineer")).toBe(
      "https://dealls.com/?search=software+engineer",
    );
    expect(getDeallsSearchHeaders("software engineer")).toEqual(
      expect.objectContaining({
        origin: "https://dealls.com",
        referer: "https://dealls.com/?search=software+engineer",
      }),
    );
  });

  it("normalizes public job URLs", () => {
    expect(normalizeDeallsJobUrl(`${sampleJobUrl}?utm_source=test`)).toBe(
      sampleJobUrl,
    );
    expect(
      buildDeallsJobUrl({
        jobSlug: "software-engineer",
        companySlug: "acme",
      }),
    ).toBe(sampleJobUrl);
  });

  it("parses Dealls search and detail API payloads", () => {
    expect(
      parseDeallsSearchPayload({
        data: {
          docs: [createDeallsJob(), createDeallsJob({ id: "job-124" })],
          totalDocs: 2,
          totalPages: 1,
          page: 1,
        },
      }),
    ).toMatchObject({
      totalDocs: 2,
      totalPages: 1,
      page: 1,
      jobs: [expect.objectContaining({ id: "job-123" }), expect.any(Object)],
    });
    expect(
      parseDeallsDetailPayload({
        code: 200,
        data: { result: createDeallsDetail() },
      }),
    ).toMatchObject({ id: "job-123", role: "Senior Software Engineer" });
  });

  it("maps search and detail API jobs into CreateJobInput", () => {
    const mapped = mapDeallsJob(createDeallsJob(), createDeallsDetail());

    expect(mapped).toEqual(
      expect.objectContaining({
        source: "dealls",
        sourceJobId: "job-123",
        title: "Senior Software Engineer",
        employer: "Acme Indonesia",
        employerUrl: "https://dealls.com/companies/acme",
        jobUrl: sampleJobUrl,
        applicationLink: "https://apply.example/job-123",
        salary: "IDR 8000000-12000000 / monthly",
        location: "Jakarta Selatan, Indonesia",
        datePosted: "2026-05-01T10:00:00.000Z",
        jobType: "full_time",
        skills: "TypeScript, React",
        companyIndustry: "Technology",
        companyUrlDirect: "https://acme.example",
        companyLogo: "https://cdn.example/detail-logo.png",
        workFromHomeType: "remote",
      }),
    );
    expect(mapped?.jobDescription).toContain("Build reliable products");
    expect(mapped?.jobDescription).toContain("Requirements");
    expect(mapped?.jobDescription).toContain("Remote allowance");
    expect(mapped?.salaryMinAmount).toBe(8_000_000);
    expect(mapped?.salaryMaxAmount).toBe(12_000_000);
    expect(mapped?.salaryCurrency).toBe("IDR");
    expect(mapped?.locationEvidence).toMatchObject({
      rawLocation: "Jakarta Selatan, Indonesia",
      location: "Jakarta Selatan, Indonesia",
      countryKey: "indonesia",
      country: "indonesia",
      city: "Jakarta Selatan",
      workplaceType: "remote",
      isRemote: true,
      source: "dealls",
    });
  });

  it("filters non-Indonesia jobs before mapping", () => {
    const nonIndonesia = createDeallsJob({
      country: { id: 188, name: "Singapore" },
      city: { name: "Singapore" },
    });

    expect(isIndonesiaDeallsJob(createDeallsJob())).toBe(true);
    expect(isIndonesiaDeallsJob(nonIndonesia)).toBe(false);
    expect(mapDeallsJob(nonIndonesia)).toBeNull();
  });

  it("does not invent numeric salary for negotiable jobs", () => {
    const mapped = mapDeallsJob(
      createDeallsJob({
        salaryRange: null,
        salaryType: "Negotiable",
      }),
    );

    expect(mapped?.salary).toBeUndefined();
    expect(mapped?.salaryMinAmount).toBeUndefined();
    expect(mapped?.salaryMaxAmount).toBeUndefined();
  });

  it("dedupes by source id or URL and skips existing URLs", () => {
    expect(
      dedupeDeallsJobs(
        [
          createJob(),
          createJob({ jobUrl: `${sampleJobUrl}?utm=copy` }),
          createJob({
            sourceJobId: "job-456",
            jobUrl: "https://dealls.com/loker/backend-engineer~acme",
          }),
        ],
        [sampleJobUrl],
      ).map((job) => job.jobUrl),
    ).toEqual(["https://dealls.com/loker/backend-engineer~acme"]);
  });

  it("resolves max jobs per term safely", () => {
    expect(resolveDeallsMaxJobsPerTerm("12")).toBe(12);
    expect(resolveDeallsMaxJobsPerTerm("bad")).toBe(50);
    expect(resolveDeallsMaxJobsPerTerm(-3)).toBe(1);
    expect(resolveDeallsMaxJobsPerTerm(2000)).toBe(1000);
  });

  it("derives role-oriented fallback terms from specific Dealls keywords", () => {
    expect(
      deriveDeallsFallbackSearchTerms(
        "Cloud Infrastructure (AWS & Alibaba Cloud)",
      ),
    ).toEqual(["cloud engineer", "Cloud Infrastructure", "Alibaba Cloud"]);
    expect(
      deriveDeallsFallbackSearchTerms("DevOps & CI/CD Automation"),
    ).toEqual(["DevOps", "site reliability engineer", "CI CD Automation"]);
    expect(deriveDeallsFallbackSearchTerms("EC2")).toEqual(["cloud engineer"]);
  });
});

describe("runDeallsWithFetcher", () => {
  it("fetches search and detail API results, applies max caps, and forwards headers", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: createDeallsDetail() } });
      }
      return jsonResponse({
        data: {
          totalDocs: 3,
          totalPages: 1,
          page: 1,
          docs: [
            createDeallsJob({ id: "job-123", slug: "software-engineer" }),
            createDeallsJob({ id: "job-124", slug: "backend-engineer" }),
            createDeallsJob({ id: "job-125", slug: "frontend-engineer" }),
          ],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      { searchTerms: ["software engineer"], maxJobsPerTerm: 2 },
      fetchImpl,
    );

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "job-123",
      "job-124",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.sejutacita.id/v1/explore-job/job?published=true&status=active&sortParam=mostRelevant&sortBy=asc&externalPlatformApplyUrlSet=null&boostTheBoostedJob=true&limit=18&page=1&search=software+engineer",
      expect.objectContaining({
        headers: expect.objectContaining({
          origin: "https://dealls.com",
          referer: "https://dealls.com/?search=software+engineer",
        }),
      }),
    );
  });

  it("uses search payload fallback when detail enrichment fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({}, { status: 503 });
      }
      return jsonResponse({
        data: {
          totalDocs: 1,
          totalPages: 1,
          page: 1,
          docs: [createDeallsJob()],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      { searchTerms: ["software"] },
      fetchImpl,
    );

    expect(result).toEqual({
      success: true,
      jobs: [
        expect.objectContaining({
          sourceJobId: "job-123",
          title: "Software Engineer",
        }),
      ],
    });
  });

  it("fetches additional pages until the max cap is reached", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: {} } });
      }
      const page = new URL(url).searchParams.get("page");
      return jsonResponse({
        data: {
          totalDocs: 4,
          totalPages: 2,
          page: Number(page),
          docs:
            page === "1"
              ? [createDeallsJob({ id: "job-123" })]
              : [
                  createDeallsJob({
                    id: "job-124",
                    slug: "backend-engineer",
                  }),
                ],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      { searchTerms: ["software"], maxJobsPerTerm: 2 },
      fetchImpl,
    );

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "job-123",
      "job-124",
    ]);
  });

  it("tries fallback role terms when an exact Dealls term has no first-page results", async () => {
    const onProgress = vi.fn();
    const searchTermsRequested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: createDeallsDetail() } });
      }
      const search = new URL(url).searchParams.get("search") ?? "";
      searchTermsRequested.push(search);
      return jsonResponse({
        data: {
          totalDocs: search === "cloud engineer" ? 1 : 0,
          totalPages: search === "cloud engineer" ? 1 : 0,
          page: 1,
          docs:
            search === "cloud engineer"
              ? [
                  createDeallsJob({
                    id: "job-cloud",
                    slug: "cloud-engineer",
                    role: "Cloud Engineer",
                  }),
                ]
              : [],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      {
        searchTerms: ["Cloud Infrastructure (AWS & Alibaba Cloud)"],
        maxJobsPerTerm: 1,
        onProgress,
      },
      fetchImpl,
    );

    expect(result.jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "job-cloud",
        title: "Senior Software Engineer",
      }),
    ]);
    expect(searchTermsRequested).toEqual([
      "Cloud Infrastructure (AWS & Alibaba Cloud)",
      "cloud engineer",
    ]);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "term_fallback",
        searchTerm: "Cloud Infrastructure (AWS & Alibaba Cloud)",
        fallbackSearchTerms: [
          "cloud engineer",
          "Cloud Infrastructure",
          "Alibaba Cloud",
        ],
      }),
    );
  });

  it("does not try fallback terms when the exact term returns jobs", async () => {
    const onProgress = vi.fn();
    const searchTermsRequested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: createDeallsDetail() } });
      }
      searchTermsRequested.push(new URL(url).searchParams.get("search") ?? "");
      return jsonResponse({
        data: {
          totalDocs: 1,
          totalPages: 1,
          page: 1,
          docs: [createDeallsJob()],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      {
        searchTerms: ["software engineer"],
        maxJobsPerTerm: 1,
        onProgress,
      },
      fetchImpl,
    );

    expect(result.jobs).toHaveLength(1);
    expect(searchTermsRequested).toEqual(["software engineer"]);
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "term_fallback" }),
    );
  });

  it("applies max caps across fallback searches for one original term", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: {} } });
      }
      const search = new URL(url).searchParams.get("search") ?? "";
      return jsonResponse({
        data: {
          totalDocs: search === "DevOps" ? 3 : 0,
          totalPages: search === "DevOps" ? 1 : 0,
          page: 1,
          docs:
            search === "DevOps"
              ? [
                  createDeallsJob({ id: "job-1", slug: "devops-engineer-1" }),
                  createDeallsJob({ id: "job-2", slug: "devops-engineer-2" }),
                  createDeallsJob({ id: "job-3", slug: "devops-engineer-3" }),
                ]
              : [],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      {
        searchTerms: ["DevOps & CI/CD Automation"],
        maxJobsPerTerm: 2,
      },
      fetchImpl,
    );

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "job-1",
      "job-2",
    ]);
  });

  it("dedupes jobs found across fallback terms in the same original term group", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: {} } });
      }
      const search = new URL(url).searchParams.get("search") ?? "";
      return jsonResponse({
        data: {
          totalDocs:
            search === "DevOps" || search === "site reliability engineer"
              ? 1
              : 0,
          totalPages:
            search === "DevOps" || search === "site reliability engineer"
              ? 1
              : 0,
          page: 1,
          docs:
            search === "DevOps" || search === "site reliability engineer"
              ? [createDeallsJob({ id: "job-123", slug: "devops-engineer" })]
              : [],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      {
        searchTerms: ["DevOps & CI/CD Automation"],
        maxJobsPerTerm: 5,
      },
      fetchImpl,
    );

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["job-123"]);
  });

  it("returns partial deduped jobs when cancelled between terms", async () => {
    let shouldCancel = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        shouldCancel = true;
        return jsonResponse({ data: { result: createDeallsDetail() } });
      }
      return jsonResponse({
        data: {
          totalDocs: 1,
          totalPages: 1,
          page: 1,
          docs: [createDeallsJob()],
        },
      });
    }) as unknown as typeof fetch;

    const result = await runDeallsWithFetcher(
      {
        searchTerms: ["one", "two"],
        shouldCancel: () => shouldCancel,
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: true,
      jobs: [expect.objectContaining({ sourceJobId: "job-123" })],
    });
  });

  it("emits progress events for terms, pages, and detail jobs", async () => {
    const onProgress = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/job-portal/job/")) {
        return jsonResponse({ data: { result: createDeallsDetail() } });
      }
      return jsonResponse({
        data: {
          totalDocs: 1,
          totalPages: 1,
          page: 1,
          docs: [createDeallsJob()],
        },
      });
    }) as unknown as typeof fetch;

    await runDeallsWithFetcher(
      {
        searchTerms: ["software engineer"],
        onProgress,
      },
      fetchImpl,
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "term_start",
        searchTerm: "software engineer",
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "page_fetched", resultsOnPage: 1 }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job_complete", totalCollected: 1 }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "term_complete", jobsFoundTerm: 1 }),
    );
  });

  it("returns unhealthy-style errors for search API and JSON failures", async () => {
    const httpFailure = await runDeallsWithFetcher(
      { searchTerms: ["software"] },
      vi.fn(async () =>
        jsonResponse({}, { status: 500 }),
      ) as unknown as typeof fetch,
    );
    const invalidJson = await runDeallsWithFetcher(
      { searchTerms: ["software"] },
      vi.fn(
        async () =>
          new Response("not json", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      ) as unknown as typeof fetch,
    );

    expect(httpFailure).toMatchObject({
      success: false,
      jobs: [],
      error: "Dealls search request failed with HTTP 500",
    });
    expect(invalidJson).toMatchObject({
      success: false,
      jobs: [],
      error: "Dealls search response was not valid JSON.",
    });
  });

  it("handles empty result pages", async () => {
    const result = await runDeallsWithFetcher(
      { searchTerms: ["software"] },
      vi.fn(async () =>
        jsonResponse({
          data: { totalDocs: 0, totalPages: 0, page: 1, docs: [] },
        }),
      ) as unknown as typeof fetch,
    );

    expect(result).toEqual({ success: true, jobs: [] });
  });
});
