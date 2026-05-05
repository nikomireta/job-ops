import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it, vi } from "vitest";
import {
  buildKalibrrJobUrl,
  dedupeKalibrrJobs,
  extractKalibrrSourceJobId,
  getKalibrrSearchHeaders,
  isIndonesiaKalibrrJob,
  makeKalibrrRefererUrl,
  makeKalibrrSearchUrl,
  mapKalibrrJob,
  normalizeKalibrrJobUrl,
  parseKalibrrSearchPayload,
  resolveKalibrrMaxJobsPerTerm,
  runKalibrrWithFetcher,
} from "../src/run";

const sampleJobUrl =
  "https://www.kalibrr.com/id-ID/c/acme/jobs/123/software-engineer";

function createKalibrrJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 123,
    slug: "software-engineer",
    name: "Software Engineer",
    company_name: "Acme Indonesia",
    company: {
      code: "acme",
      name: "Acme Indonesia",
      logo_small: "https://cdn.example/logo.png",
    },
    company_info: {
      code: "acme",
      name: "Acme Indonesia",
      industry: "Technology",
      url: "https://acme.example",
      description: "Builds useful tools.",
    },
    description: "<p>Build reliable products.</p>",
    qualifications: "<ul><li>TypeScript</li><li>Testing</li></ul>",
    google_location: {
      address_components: {
        city: "Jakarta Selatan",
        region: "DKI Jakarta",
        country: "Indonesia",
      },
    },
    is_work_from_home: false,
    is_hybrid: true,
    salary_shown: true,
    base_salary: 5_000_000,
    maximum_salary: 9_000_000,
    salary_currency: "IDR",
    salary_interval: "monthly",
    apply_redirect_url: "https://apply.example/123",
    activation_date: "2026-05-01T10:00:00Z",
    application_end_date: "2026-06-01T00:00:00Z",
    tenure: "Full-time",
    function: "Engineering",
    job_sds_skills: [
      { sds_skill: { name: "TypeScript" } },
      { sds_skill: { name: "React" } },
      { sds_skill: { name: "TypeScript" } },
    ],
    number_of_openings: 3,
    ...overrides,
  };
}

function createJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "kalibrr",
    sourceJobId: "123",
    title: "Software Engineer",
    employer: "Acme Indonesia",
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

describe("kalibrr extractor mapping", () => {
  it("builds search URLs and Indonesia referer headers", () => {
    const url = new URL(
      makeKalibrrSearchUrl({
        keyword: "software engineer",
        offset: 15,
        limit: 15,
      }),
    );

    expect(url.origin).toBe("https://www.kalibrr.com");
    expect(url.pathname).toBe("/kjs/job_board/search");
    expect(url.searchParams.get("limit")).toBe("15");
    expect(url.searchParams.get("offset")).toBe("15");
    expect(url.searchParams.get("text")).toBe("software engineer");
    expect(makeKalibrrRefererUrl("software engineer")).toBe(
      "https://www.kalibrr.com/id-ID/home/te/software-engineer",
    );
    expect(getKalibrrSearchHeaders("software engineer")).toEqual(
      expect.objectContaining({
        referer: "https://www.kalibrr.com/id-ID/home/te/software-engineer",
      }),
    );
  });

  it("normalizes public job URLs and extracts source ids", () => {
    const noisy = `${sampleJobUrl}?utm_source=test`;

    expect(extractKalibrrSourceJobId(noisy)).toBe("123");
    expect(normalizeKalibrrJobUrl(noisy)).toBe(sampleJobUrl);
    expect(
      buildKalibrrJobUrl({
        companyCode: "acme",
        id: "123",
        slug: "software-engineer",
      }),
    ).toBe(sampleJobUrl);
  });

  it("parses snake_case Kalibrr API payloads", () => {
    expect(
      parseKalibrrSearchPayload({
        count: 2,
        jobs: [createKalibrrJob(), createKalibrrJob({ id: 124 })],
      }),
    ).toMatchObject({
      count: 2,
      jobs: [expect.objectContaining({ id: 123 }), expect.any(Object)],
    });
  });

  it("maps API jobs into CreateJobInput", () => {
    const mapped = mapKalibrrJob(createKalibrrJob());

    expect(mapped).toEqual(
      expect.objectContaining({
        source: "kalibrr",
        sourceJobId: "123",
        title: "Software Engineer",
        employer: "Acme Indonesia",
        employerUrl: "https://www.kalibrr.com/id-ID/c/acme/jobs",
        jobUrl: sampleJobUrl,
        applicationLink: "https://apply.example/123",
        salary: "IDR 5000000-9000000 / monthly",
        location: "Jakarta Selatan, DKI Jakarta",
        deadline: "2026-06-01T00:00:00.000Z",
        datePosted: "2026-05-01T10:00:00.000Z",
        jobType: "Full-time",
        skills: "TypeScript, React",
        companyIndustry: "Technology",
        companyUrlDirect: "https://acme.example",
        companyLogo: "https://cdn.example/logo.png",
        vacancyCount: 3,
        workFromHomeType: "hybrid",
      }),
    );
    expect(mapped?.jobDescription).toContain("Build reliable products");
    expect(mapped?.jobDescription).toContain("TypeScript");
    expect(mapped?.jobDescription).toContain("Testing");
    expect(mapped?.locationEvidence).toMatchObject({
      rawLocation: "Jakarta Selatan, DKI Jakarta",
      location: "Jakarta Selatan, DKI Jakarta, Indonesia",
      countryKey: "indonesia",
      country: "indonesia",
      city: "Jakarta Selatan",
      regionHints: ["DKI Jakarta"],
      workplaceType: "hybrid",
      isHybrid: true,
      source: "kalibrr",
    });
  });

  it("filters non-Indonesia jobs before mapping", () => {
    const nonIndonesia = createKalibrrJob({
      google_location: {
        address_components: {
          city: "Singapore",
          country: "Singapore",
        },
      },
    });

    expect(isIndonesiaKalibrrJob(createKalibrrJob())).toBe(true);
    expect(isIndonesiaKalibrrJob(nonIndonesia)).toBe(false);
    expect(mapKalibrrJob(nonIndonesia)).toBeNull();
  });

  it("hides salary fields when Kalibrr marks salary as hidden", () => {
    const mapped = mapKalibrrJob(
      createKalibrrJob({
        salary_shown: false,
      }),
    );

    expect(mapped?.salary).toBeUndefined();
    expect(mapped?.salaryMinAmount).toBeUndefined();
    expect(mapped?.salaryMaxAmount).toBeUndefined();
    expect(mapped?.salaryCurrency).toBeUndefined();
  });

  it("dedupes by source id or URL and skips existing URLs", () => {
    expect(
      dedupeKalibrrJobs(
        [
          createJob(),
          createJob({ jobUrl: `${sampleJobUrl}?utm=copy` }),
          createJob({
            sourceJobId: "456",
            jobUrl:
              "https://www.kalibrr.com/id-ID/c/acme/jobs/456/backend-engineer",
          }),
        ],
        [sampleJobUrl],
      ).map((job) => job.jobUrl),
    ).toEqual([
      "https://www.kalibrr.com/id-ID/c/acme/jobs/456/backend-engineer",
    ]);
  });

  it("resolves max jobs per term safely", () => {
    expect(resolveKalibrrMaxJobsPerTerm("12")).toBe(12);
    expect(resolveKalibrrMaxJobsPerTerm("bad")).toBe(50);
    expect(resolveKalibrrMaxJobsPerTerm(-3)).toBe(1);
    expect(resolveKalibrrMaxJobsPerTerm(2000)).toBe(1000);
  });
});

describe("runKalibrrWithFetcher", () => {
  it("fetches paginated API results, applies max caps, and forwards headers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        count: 30,
        jobs: [
          createKalibrrJob({ id: 123, slug: "software-engineer" }),
          createKalibrrJob({ id: 124, slug: "backend-engineer" }),
          createKalibrrJob({ id: 125, slug: "frontend-engineer" }),
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await runKalibrrWithFetcher(
      { searchTerms: ["software engineer"], maxJobsPerTerm: 2 },
      fetchImpl,
    );

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["123", "124"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.kalibrr.com/kjs/job_board/search?limit=15&offset=0&text=software+engineer",
      expect.objectContaining({
        headers: expect.objectContaining({
          referer: "https://www.kalibrr.com/id-ID/home/te/software-engineer",
        }),
      }),
    );
  });

  it("returns partial deduped jobs when cancelled between terms", async () => {
    let shouldCancel = false;
    const fetchImpl = vi.fn(async () => {
      shouldCancel = true;
      return jsonResponse({ count: 1, jobs: [createKalibrrJob()] });
    }) as unknown as typeof fetch;

    const result = await runKalibrrWithFetcher(
      {
        searchTerms: ["one", "two"],
        shouldCancel: () => shouldCancel,
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: true,
      jobs: [expect.objectContaining({ sourceJobId: "123" })],
    });
  });

  it("emits progress events for terms and pages", async () => {
    const onProgress = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ count: 1, jobs: [createKalibrrJob()] }),
    ) as unknown as typeof fetch;

    await runKalibrrWithFetcher(
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
      expect.objectContaining({ type: "page_fetched", totalCollected: 1 }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "term_complete", jobsFoundTerm: 1 }),
    );
  });

  it("returns unhealthy-style errors for API and JSON failures", async () => {
    const httpFailure = await runKalibrrWithFetcher(
      { searchTerms: ["software"] },
      vi.fn(async () =>
        jsonResponse({}, { status: 500 }),
      ) as unknown as typeof fetch,
    );
    const invalidJson = await runKalibrrWithFetcher(
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
      error: "Kalibrr search request failed with HTTP 500",
    });
    expect(invalidJson).toMatchObject({
      success: false,
      jobs: [],
      error: "Kalibrr search response was not valid JSON.",
    });
  });

  it("handles empty result pages", async () => {
    const result = await runKalibrrWithFetcher(
      { searchTerms: ["software"] },
      vi.fn(async () =>
        jsonResponse({ count: 0, jobs: [] }),
      ) as unknown as typeof fetch,
    );

    expect(result).toEqual({ success: true, jobs: [] });
  });
});
