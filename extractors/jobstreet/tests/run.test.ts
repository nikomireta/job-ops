import { runInNewContext } from "node:vm";
import type { CreateJobInput } from "@shared/types/jobs";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  dedupeJobStreetJobs,
  extractJobStreetCardPayloadsFromPage,
  extractJobStreetSourceJobId,
  formatJobStreetPostedDate,
  inferJobStreetWorkplaceType,
  JOBSTREET_CARD_PAYLOAD_SCRIPT,
  type JobStreetCardPayload,
  makeJobStreetSearchUrl,
  mapJobStreetCardPayload,
  normalizeJobStreetJobUrl,
  resolveJobStreetMaxJobsPerTerm,
  runJobStreetWithCollector,
  slugifyJobStreetSegment,
} from "../src/run";

const jobUrl = "https://id.jobstreet.com/job/91889473";

function createJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "jobstreet",
    sourceJobId: "91889473",
    title: "Software Engineer",
    employer: "Acme Indonesia",
    jobUrl,
    ...overrides,
  };
}

describe("jobstreet extractor mapping", () => {
  it("slugifies search path segments", () => {
    expect(slugifyJobStreetSegment("Software Engineer / DevOps")).toBe(
      "software-engineer-devops",
    );
    expect(slugifyJobStreetSegment("  Jakarta Selatan  ")).toBe(
      "jakarta-selatan",
    );
  });

  it("builds public search URLs with optional city and page", () => {
    expect(makeJobStreetSearchUrl({ keyword: "software engineer" })).toBe(
      "https://id.jobstreet.com/software-engineer-jobs",
    );
    expect(
      makeJobStreetSearchUrl({
        keyword: "software engineer",
        location: "Jakarta Selatan",
        page: 2,
      }),
    ).toBe(
      "https://id.jobstreet.com/software-engineer-jobs/in-jakarta-selatan?page=2",
    );
  });

  it("normalizes JobStreet job URLs and extracts source ids", () => {
    const noisy =
      "https://id.jobstreet.com/job/91889473?type=standard&ref=search";

    expect(extractJobStreetSourceJobId(noisy)).toBe("91889473");
    expect(normalizeJobStreetJobUrl(noisy)).toBe(jobUrl);
    expect(normalizeJobStreetJobUrl("https://example.com/job/91889473")).toBe(
      undefined,
    );
  });

  it("infers workplace type from English and Indonesian card text", () => {
    expect(inferJobStreetWorkplaceType("Work from home available")).toBe(
      "remote",
    );
    expect(inferJobStreetWorkplaceType("Hybrid setup")).toBe("hybrid");
    expect(inferJobStreetWorkplaceType("Kerja di kantor")).toBe("onsite");
  });

  it("formats relative posted dates", () => {
    const now = new Date("2026-05-07T12:00:00.000Z");

    expect(formatJobStreetPostedDate("Posted 3d ago", now)).toBe(
      "2026-05-04T12:00:00.000Z",
    );
    expect(formatJobStreetPostedDate("2 jam lalu", now)).toBe(
      "2026-05-07T10:00:00.000Z",
    );
  });

  it("maps public card payloads into normalized jobs", () => {
    const mapped = mapJobStreetCardPayload({
      jobUrl: `${jobUrl}?ref=search`,
      title: "Software Engineer",
      employer: "Acme Indonesia",
      location: "Jakarta Selatan",
      salary: "Rp 10.000.000 - Rp 15.000.000 per month",
      jobType: "Full time",
      listedAt: "Posted 3d ago",
      classification: "Information & Communication Technology",
      snippet: "Build reliable marketplace systems. Hybrid work setup.",
      text: "Software Engineer\nAcme Indonesia\nJakarta Selatan",
      companyLogo: "https://example.com/logo.png",
    });

    expect(mapped).toEqual(
      expect.objectContaining({
        source: "jobstreet",
        sourceJobId: "91889473",
        title: "Software Engineer",
        employer: "Acme Indonesia",
        jobUrl,
        applicationLink: jobUrl,
        salary: "Rp 10.000.000 - Rp 15.000.000 per month",
        location: "Jakarta Selatan",
        jobType: "Full time",
        jobFunction: "Information & Communication Technology",
        workFromHomeType: "hybrid",
        companyLogo: "https://example.com/logo.png",
      }),
    );
    expect(mapped?.locationEvidence).toMatchObject({
      rawLocation: "Jakarta Selatan",
      location: "Jakarta Selatan, Indonesia",
      countryKey: "indonesia",
      country: "indonesia",
      source: "jobstreet",
    });
  });

  it("dedupes by source id or URL and skips existing URLs", () => {
    const jobs = [
      createJob(),
      createJob({ jobUrl: `${jobUrl}?ref=copy` }),
      createJob({
        sourceJobId: "91889474",
        jobUrl: "https://id.jobstreet.com/job/91889474",
      }),
    ];

    expect(
      dedupeJobStreetJobs(jobs, [jobUrl]).map((job) => job.jobUrl),
    ).toEqual(["https://id.jobstreet.com/job/91889474"]);
  });

  it("resolves max jobs per term safely", () => {
    expect(resolveJobStreetMaxJobsPerTerm("12")).toBe(12);
    expect(resolveJobStreetMaxJobsPerTerm("bad")).toBe(50);
    expect(resolveJobStreetMaxJobsPerTerm(-3)).toBe(1);
    expect(resolveJobStreetMaxJobsPerTerm(2000)).toBe(1000);
  });

  it("extracts cards with a self-contained browser script string", async () => {
    const payload = {
      jobUrl,
      title: "Software Engineer",
      employer: "Acme Indonesia",
    };
    const evaluate = vi.fn().mockResolvedValue([payload]);
    const page = { evaluate } as unknown as Page;

    await expect(extractJobStreetCardPayloadsFromPage(page)).resolves.toEqual([
      payload,
    ]);

    const script = evaluate.mock.calls[0]?.[0];
    expect(typeof script).toBe("string");
    expect(script).not.toContain("__name");
  });

  it("reads public card metadata from a fixture DOM", () => {
    document.body.innerHTML = `
      <main>
        <article data-automation="normalJob">
          <a href="https://id.jobstreet.com/job/91889473?ref=search">
            <h3 data-automation="jobTitle">Software Engineer</h3>
          </a>
          <span data-automation="jobCompany">Acme Indonesia</span>
          <span data-automation="jobLocation">Jakarta Selatan</span>
          <span data-automation="jobSalary">Rp 10.000.000 - Rp 15.000.000 per month</span>
          <span data-automation="jobWorkType">Full time</span>
          <time data-automation="jobListingDate">Posted 3d ago</time>
          <span data-automation="jobClassification">Information & Communication Technology</span>
          <p data-automation="jobShortDescription">Build reliable marketplace systems. Hybrid work setup.</p>
          <img src="https://example.com/logo.png" />
        </article>
      </main>
    `;

    const payloads = runInNewContext(JOBSTREET_CARD_PAYLOAD_SCRIPT, {
      document,
      Set,
    }) as JobStreetCardPayload[];

    expect(payloads).toEqual([
      expect.objectContaining({
        jobUrl: `${jobUrl}?ref=search`,
        title: "Software Engineer",
        employer: "Acme Indonesia",
        location: "Jakarta Selatan",
        salary: "Rp 10.000.000 - Rp 15.000.000 per month",
        jobType: "Full time",
        listedAt: "Posted 3d ago",
        classification: "Information & Communication Technology",
        snippet: "Build reliable marketplace systems. Hybrid work setup.",
        companyLogo: "https://example.com/logo.png",
      }),
    ]);
    expect(
      mapJobStreetCardPayload(payloads[0] as JobStreetCardPayload),
    ).toEqual(
      expect.objectContaining({
        source: "jobstreet",
        sourceJobId: "91889473",
        title: "Software Engineer",
        employer: "Acme Indonesia",
        jobUrl,
      }),
    );
  });
});

describe("runJobStreetWithCollector", () => {
  it("passes resolved caps and location to the term collector", async () => {
    const collectTerm = vi.fn().mockResolvedValue({ jobs: [createJob()] });

    const result = await runJobStreetWithCollector(
      {
        searchTerms: ["backend"],
        locations: ["Jakarta"],
        maxJobsPerTerm: 7,
      },
      collectTerm,
    );

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(collectTerm).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerm: "backend",
        location: "Jakarta",
        maxJobsPerTerm: 7,
      }),
    );
  });

  it("surfaces challenge-required collector failures", async () => {
    const result = await runJobStreetWithCollector(
      { searchTerms: ["software engineer"] },
      async () => ({
        jobs: [],
        challengeRequired: "https://id.jobstreet.com/software-engineer-jobs",
      }),
    );

    expect(result).toEqual({
      success: false,
      jobs: [],
      challengeRequired: "https://id.jobstreet.com/software-engineer-jobs",
    });
  });

  it("surfaces empty public-card errors", async () => {
    const result = await runJobStreetWithCollector(
      { searchTerms: ["software engineer"] },
      async () => ({
        jobs: [],
        error: "JobStreet search page did not expose public job cards.",
      }),
    );

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "JobStreet search page did not expose public job cards.",
    });
  });

  it("returns partial deduped jobs when cancelled between terms", async () => {
    let shouldCancel = false;
    const result = await runJobStreetWithCollector(
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
