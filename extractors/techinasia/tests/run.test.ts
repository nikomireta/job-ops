import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it, vi } from "vitest";
import {
  buildTechInAsiaJobUrl,
  dedupeTechInAsiaJobs,
  extractTechInAsiaSourceJobId,
  getTechInAsiaAlgoliaConfig,
  isIndonesiaTechInAsiaJob,
  makeTechInAsiaSearchRequest,
  mapTechInAsiaJob,
  normalizeTechInAsiaJobUrl,
  parseTechInAsiaSearchPayload,
  resolveTechInAsiaMaxJobsPerTerm,
  runTechInAsiaWithFetcher,
} from "../src/run";

const sampleJobId = "5441069a-5114-4f87-9463-583234a808f3";
const sampleJobUrl = `https://www.techinasia.com/jobs/${sampleJobId}`;

function createTechInAsiaJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: sampleJobId,
    objectID: sampleJobId,
    title: "Software Engineer",
    company: {
      avatar: "https://cdn.techinasia.com/logo.png",
      entity_slug: "acme-indonesia",
      name: "Acme Indonesia",
      employee_count: "51 - 200",
      employee_rating: 4.5,
      entity_locations: [
        {
          country_name: "Indonesia",
          type: "hq",
        },
      ],
      website: "https://acme.example",
    },
    city: {
      country_name: "Indonesia",
      work_country_name: "Indonesia",
      name: "Jakarta",
    },
    currency: {
      currency_code: "IDR",
      currency_symbol: "Rp",
    },
    description:
      "<p>Build reliable products &amp; tools.</p><ul><li>TypeScript</li></ul>",
    experience: "3-5",
    expires_at: "2026-07-04 10:10:52",
    external_link: "https://apply.example/jobs/software-engineer",
    industries: [
      {
        name: "Internet technology",
        vertical_name: "Technology",
      },
    ],
    is_remote: 0,
    is_salary_visible: 1,
    job_skills: [
      { name: "TypeScript" },
      { name: "React" },
      { name: "TypeScript" },
    ],
    job_type: {
      name: "Full-time",
    },
    position: {
      name: "Engineering",
    },
    published_at: "2026-05-01 08:00:00",
    salary_avg: 7_000_000,
    salary_max: 9_000_000,
    salary_min: 5_000_000,
    vacancy_count: 2,
    work_arrangement: "hybrid",
    ...overrides,
  };
}

function createJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "techinasia",
    sourceJobId: sampleJobId,
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

function searchPayload(args: {
  hits: Record<string, unknown>[];
  page?: number;
  nbPages?: number;
  nbHits?: number;
}): unknown {
  return {
    results: [
      {
        hits: args.hits,
        page: args.page ?? 0,
        nbPages: args.nbPages ?? 1,
        nbHits: args.nbHits ?? args.hits.length,
      },
    ],
  };
}

describe("techinasia extractor mapping", () => {
  it("builds Algolia search requests with Indonesia facet filters", () => {
    const request = makeTechInAsiaSearchRequest({
      searchTerm: "software engineer",
      page: 2,
      hitsPerPage: 10,
      config: {
        appId: "app",
        apiKey: "key",
        indexName: "jobs",
      },
    });
    const url = new URL(request.url);
    const params = new URLSearchParams(request.body.requests[0]?.params);

    expect(url.origin).toBe("https://219wx3mpv4-dsn.algolia.net");
    expect(url.pathname).toBe("/1/indexes/*/queries");
    expect(url.searchParams.get("x-algolia-application-id")).toBe("app");
    expect(url.searchParams.get("x-algolia-api-key")).toBe("key");
    expect(request.body.requests[0]?.indexName).toBe("jobs");
    expect(params.get("query")).toBe("software engineer");
    expect(params.get("hitsPerPage")).toBe("10");
    expect(params.get("page")).toBe("2");
    expect(JSON.parse(params.get("facetFilters") ?? "[]")).toEqual([
      "city.country_name:Indonesia",
    ]);
  });

  it("reads Algolia defaults with optional env overrides", () => {
    expect(getTechInAsiaAlgoliaConfig({})).toMatchObject({
      appId: "219WX3MPV4",
      apiKey: "b528008a75dc1c4402bfe0d8db8b3f8e",
      indexName: "job_postings",
    });
    expect(
      getTechInAsiaAlgoliaConfig({
        TECHINASIA_ALGOLIA_APP_ID: "custom-app",
        TECHINASIA_ALGOLIA_API_KEY: "custom-key",
        TECHINASIA_ALGOLIA_INDEX: "custom-index",
      }),
    ).toEqual({
      appId: "custom-app",
      apiKey: "custom-key",
      indexName: "custom-index",
    });
  });

  it("parses Algolia search payloads", () => {
    const page = parseTechInAsiaSearchPayload(
      searchPayload({
        hits: [createTechInAsiaJob()],
        page: 1,
        nbPages: 3,
        nbHits: 12,
      }),
    );

    expect(page).toMatchObject({
      page: 1,
      nbPages: 3,
      nbHits: 12,
    });
    expect(page.hits).toHaveLength(1);
  });

  it("normalizes public job URLs and extracts source ids", () => {
    const noisy = `${sampleJobUrl}?utm_source=test`;

    expect(extractTechInAsiaSourceJobId(noisy)).toBe(sampleJobId);
    expect(normalizeTechInAsiaJobUrl(noisy)).toBe(sampleJobUrl);
    expect(buildTechInAsiaJobUrl(sampleJobId)).toBe(sampleJobUrl);
  });

  it("maps Indonesia Algolia hits into normalized jobs", () => {
    const mapped = mapTechInAsiaJob(createTechInAsiaJob());

    expect(mapped).toMatchObject({
      source: "techinasia",
      sourceJobId: sampleJobId,
      title: "Software Engineer",
      employer: "Acme Indonesia",
      employerUrl: "https://www.techinasia.com/companies/acme-indonesia",
      jobUrl: sampleJobUrl,
      applicationLink: "https://apply.example/jobs/software-engineer",
      salary: "IDR 5,000,000 - 9,000,000",
      location: "Jakarta, Indonesia",
      jobType: "Full-time",
      salaryMinAmount: 5_000_000,
      salaryMaxAmount: 9_000_000,
      salaryCurrency: "IDR",
      jobFunction: "Engineering",
      companyIndustry: "Internet technology, Technology",
      companyLogo: "https://cdn.techinasia.com/logo.png",
      companyUrlDirect: "https://acme.example",
      companyNumEmployees: "51 - 200",
      skills: "TypeScript, React",
      experienceRange: "3-5",
      companyRating: 4.5,
      vacancyCount: 2,
      workFromHomeType: "hybrid",
    });
    expect(mapped?.jobDescription).toContain(
      "Build reliable products & tools.",
    );
    expect(mapped?.jobDescription).toContain("TypeScript");
    expect(mapped?.locationEvidence).toMatchObject({
      countryKey: "indonesia",
      country: "indonesia",
      city: "Jakarta",
      workplaceType: "hybrid",
      isHybrid: true,
      source: "techinasia",
    });
  });

  it("omits hidden salary values", () => {
    const mapped = mapTechInAsiaJob(
      createTechInAsiaJob({
        is_salary_visible: 0,
        salary_min: 5_000_000,
        salary_max: 9_000_000,
      }),
    );

    expect(mapped?.salary).toBeUndefined();
    expect(mapped?.salaryMinAmount).toBeUndefined();
    expect(mapped?.salaryMaxAmount).toBeUndefined();
  });

  it("filters non-Indonesia jobs", () => {
    const job = createTechInAsiaJob({
      city: {
        country_name: "Singapore",
        work_country_name: "Singapore",
        name: "Singapore",
      },
      company: {
        name: "Acme Singapore",
        entity_slug: "acme-singapore",
        entity_locations: [{ country_name: "Singapore" }],
      },
    });

    expect(isIndonesiaTechInAsiaJob(job)).toBe(false);
    expect(mapTechInAsiaJob(job)).toBeNull();
  });

  it("dedupes by source id, normalized URL, and existing job URLs", () => {
    const otherId = "d46acfdb-1dd9-41db-b498-34e15c20270f";
    const jobs = dedupeTechInAsiaJobs(
      [
        createJob({ jobUrl: `${sampleJobUrl}?utm_source=test` }),
        createJob({ jobUrl: sampleJobUrl }),
        createJob({
          sourceJobId: otherId,
          jobUrl: buildTechInAsiaJobUrl(otherId),
        }),
      ],
      [sampleJobUrl],
    );

    expect(jobs).toEqual([
      expect.objectContaining({
        sourceJobId: otherId,
        jobUrl: buildTechInAsiaJobUrl(otherId),
      }),
    ]);
  });

  it("clamps max jobs per term", () => {
    expect(resolveTechInAsiaMaxJobsPerTerm("bad")).toBe(50);
    expect(resolveTechInAsiaMaxJobsPerTerm("0")).toBe(1);
    expect(resolveTechInAsiaMaxJobsPerTerm("1200")).toBe(1000);
    expect(resolveTechInAsiaMaxJobsPerTerm("25")).toBe(25);
  });
});

describe("techinasia extractor runner", () => {
  it("paginates until max jobs per term is reached", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          searchPayload({
            hits: [createTechInAsiaJob()],
            page: 0,
            nbPages: 3,
            nbHits: 3,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          searchPayload({
            hits: [
              createTechInAsiaJob({
                id: "d46acfdb-1dd9-41db-b498-34e15c20270f",
                objectID: "d46acfdb-1dd9-41db-b498-34e15c20270f",
                title: "Backend Engineer",
              }),
            ],
            page: 1,
            nbPages: 3,
            nbHits: 3,
          }),
        ),
      );
    const onProgress = vi.fn();

    const result = await runTechInAsiaWithFetcher(
      {
        searchTerms: ["software engineer"],
        maxJobsPerTerm: 2,
        onProgress,
      },
      fetchImpl,
    );

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "page_fetched",
        pageNo: 2,
        totalCollected: 2,
      }),
    );
  });

  it("returns collected jobs when cancelled before the next page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        searchPayload({
          hits: [createTechInAsiaJob()],
          page: 0,
          nbPages: 2,
          nbHits: 2,
        }),
      ),
    );
    const shouldCancel = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const result = await runTechInAsiaWithFetcher(
      {
        searchTerms: ["software engineer"],
        shouldCancel,
      },
      fetchImpl,
    );

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces upstream errors without raw response bodies", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("secret body", { status: 500 }));

    const result = await runTechInAsiaWithFetcher(
      {
        searchTerms: ["software engineer"],
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "Tech in Asia search request failed with HTTP 500",
    });
  });
});
