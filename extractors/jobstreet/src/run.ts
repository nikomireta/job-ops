import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";
import {
  createLaunchOptions,
  getCloudflareCookieStorageDir,
  invalidateCookies,
  isChallengePage,
  isChallengeResponse,
  loadCookies,
  readCookieJar,
  saveCookies,
  waitForChallengeResolution,
} from "browser-utils";
import {
  type Browser,
  type BrowserContext,
  firefox,
  type Page,
} from "playwright";

const EXTRACTOR_ID = "jobstreet";
const JOBSTREET_BASE_URL = "https://id.jobstreet.com";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const MAX_JOBS_PER_TERM = 1_000;
const DEFAULT_SEARCH_TERMS = ["software engineer"];
const DESCRIPTION_MAX_LENGTH = 12_000;
const RESULTS_PER_PAGE_ESTIMATE = 32;
const MAX_SEARCH_PAGES = 20;
const NAVIGATION_TIMEOUT_MS = 60_000;
const CHALLENGE_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_MS = 1_200;

const JOBSTREET_HOSTS = new Set([
  "id.jobstreet.com",
  "www.jobstreet.co.id",
  "jobstreet.co.id",
  "www.jobstreet.com",
  "jobstreet.com",
]);
const JOBSTREET_JOB_PATH_RE = /\/job\/(\d+)(?:[/?#]|$)/i;

export const JOBSTREET_CARD_PAYLOAD_SCRIPT = String.raw`
(() => {
  const clean = (value) => {
    const normalized =
      typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return normalized || undefined;
  };
  const textOf = (root, selectors) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const text = clean(element && element.textContent);
      if (text) return text;
    }
    return undefined;
  };
  const attrOf = (root, selectors, attr) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = clean(element && element.getAttribute(attr));
      if (value) return value;
    }
    return undefined;
  };
  const jobIdFromHref = (href) => {
    const match = href.match(/\/job\/(\d+)(?:[/?#]|$)/i);
    return match ? match[1] : null;
  };
  const chooseCardRoot = (anchor) => {
    const semantic =
      anchor.closest(
        "article, li, [data-automation='normalJob'], [data-automation*='job-card'], [data-testid*='job-card']",
      ) || anchor;
    let root = semantic;
    for (let depth = 0; depth < 5; depth += 1) {
      const parent = root.parentElement;
      if (!parent) break;
      const links = parent.querySelectorAll('a[href*="/job/"]').length;
      if (links > 1) break;
      const rootTextLength = root.textContent ? root.textContent.length : 0;
      const parentTextLength = parent.textContent ? parent.textContent.length : 0;
      if (parentTextLength <= rootTextLength) break;
      root = parent;
    }
    return root;
  };
  const seen = new Set();
  const out = [];
  const anchors = document.querySelectorAll('a[href*="/job/"]');

  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute("href") || "";
    const sourceJobId = jobIdFromHref(href);
    if (!sourceJobId || seen.has(sourceJobId)) continue;
    seen.add(sourceJobId);

    const root = chooseCardRoot(anchor);
    const title =
      textOf(root, [
        '[data-automation="jobTitle"]',
        '[data-automation="job-card-title"]',
        '[data-testid="job-card-title"]',
        "h1",
        "h2",
        "h3",
      ]) || clean(anchor.textContent);
    const text = clean(root.innerText || root.textContent);

    out.push({
      jobUrl: href,
      title,
      employer: textOf(root, [
        '[data-automation="jobCompany"]',
        '[data-automation="job-card-company"]',
        '[data-testid="company-name"]',
      ]),
      location: textOf(root, [
        '[data-automation="jobLocation"]',
        '[data-automation="job-card-location"]',
        '[data-testid="job-location"]',
      ]),
      salary: textOf(root, [
        '[data-automation="jobSalary"]',
        '[data-automation="job-card-salary"]',
        '[data-testid="job-salary"]',
      ]),
      jobType: textOf(root, [
        '[data-automation="jobWorkType"]',
        '[data-automation="job-card-work-type"]',
        '[data-testid="job-work-type"]',
      ]),
      listedAt: textOf(root, [
        '[data-automation="jobListingDate"]',
        '[data-automation="job-card-listed-date"]',
        '[data-testid="job-listing-date"]',
        "time",
      ]),
      classification: textOf(root, [
        '[data-automation="jobClassification"]',
        '[data-automation="jobSubClassification"]',
        '[data-testid="job-classification"]',
      ]),
      snippet: textOf(root, [
        '[data-automation="jobShortDescription"]',
        '[data-automation="jobTeaser"]',
        '[data-testid="job-card-teaser"]',
      ]),
      text,
      companyLogo: attrOf(root, ["img"], "src"),
    });
  }

  return out;
})()
`.trim();

export type JobStreetProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
      pageNo: number;
      resultsOnPage: number;
      totalCollected: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
      jobsFoundTerm: number;
    };

export interface RunJobStreetOptions {
  searchTerms?: string[];
  locations?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: JobStreetProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface JobStreetResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
  challengeRequired?: string;
}

export interface JobStreetCardPayload {
  jobUrl: string;
  title?: string;
  employer?: string;
  location?: string;
  salary?: string;
  jobType?: string;
  listedAt?: string;
  classification?: string;
  snippet?: string;
  text?: string;
  companyLogo?: string;
}

type JobStreetTermCollector = (options: {
  searchTerm: string;
  location?: string;
  maxJobsPerTerm: number;
  existingJobUrls?: string[];
  shouldCancel?: () => boolean;
  onProgress?: (event: {
    type: "page_fetched";
    searchTerm: string;
    location?: string;
    pageNo: number;
    resultsOnPage: number;
    totalCollected: number;
  }) => void;
}) => Promise<{
  jobs: CreateJobInput[];
  challengeRequired?: string;
  error?: string;
}>;

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function truncateText(
  value: string | undefined,
  maxLength = DESCRIPTION_MAX_LENGTH,
): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trim()}...`
    : value;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function slugifyJobStreetSegment(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "jobs";
}

export function resolveJobStreetMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.min(MAX_JOBS_PER_TERM, Math.max(1, Math.floor(parsed)));
}

export function makeJobStreetSearchUrl(args: {
  keyword: string;
  location?: string | null;
  page?: number;
}): string {
  const keywordSlug = slugifyJobStreetSegment(args.keyword);
  const location = args.location?.trim();
  const locationPath = location
    ? `/in-${slugifyJobStreetSegment(location)}`
    : "";
  const url = new URL(
    `/${keywordSlug}-jobs${locationPath}`,
    JOBSTREET_BASE_URL,
  );
  if (args.page && args.page > 1) {
    url.searchParams.set("page", String(Math.floor(args.page)));
  }
  return url.toString();
}

export function extractJobStreetSourceJobId(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, JOBSTREET_BASE_URL);
    if (!JOBSTREET_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    return url.pathname.match(JOBSTREET_JOB_PATH_RE)?.[1];
  } catch {
    return undefined;
  }
}

export function normalizeJobStreetJobUrl(
  value: string | undefined,
): string | undefined {
  const sourceJobId = extractJobStreetSourceJobId(value);
  return sourceJobId ? `${JOBSTREET_BASE_URL}/job/${sourceJobId}` : undefined;
}

export function inferJobStreetWorkplaceType(
  ...values: Array<string | undefined>
): "remote" | "hybrid" | "onsite" | undefined {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (
    /\b(remote|work from home|wfh|telecommute|anywhere)\b|kerja\s+(jarak\s+jauh|dari\s+rumah)/i.test(
      text,
    )
  ) {
    return "remote";
  }
  if (/\b(hybrid|hibrida)\b/i.test(text)) return "hybrid";
  if (/\b(on[-\s]?site|office|kantor)\b|di\s+kantor/i.test(text)) {
    return "onsite";
  }
  return undefined;
}

function normalizeRelativeUnit(raw: string): "minute" | "hour" | "day" | null {
  const unit = raw.toLowerCase();
  if (/^(m|min|minute|minutes|menit)$/.test(unit)) return "minute";
  if (/^(h|hr|hrs|hour|hours|jam)$/.test(unit)) return "hour";
  if (/^(d|day|days|hari)$/.test(unit)) return "day";
  return null;
}

export function formatJobStreetPostedDate(
  value: string | undefined,
  now = new Date(),
): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (/\b(just now|baru saja)\b/.test(lower)) return now.toISOString();

  const relative = lower.match(
    /(\d+)\s*(m|min|minute|minutes|menit|h|hr|hrs|hour|hours|jam|d|day|days|hari)\b/,
  );
  if (relative) {
    const amount = Number.parseInt(relative[1] ?? "", 10);
    const unit = normalizeRelativeUnit(relative[2] ?? "");
    if (Number.isFinite(amount) && unit) {
      const date = new Date(now);
      if (unit === "minute") date.setMinutes(date.getMinutes() - amount);
      if (unit === "hour") date.setHours(date.getHours() - amount);
      if (unit === "day") date.setDate(date.getDate() - amount);
      return date.toISOString();
    }
  }

  const withoutPrefix = raw
    .replace(/^posted\s+/i, "")
    .replace(/^diposting\s+/i, "")
    .replace(/\s+ago$/i, "")
    .replace(/\s+lalu$/i, "")
    .trim();
  const parsed = new Date(withoutPrefix);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function buildLocationEvidence(args: {
  location?: string;
  workplaceType?: "remote" | "hybrid" | "onsite";
}): JobLocationEvidence {
  const location = args.location?.trim();
  const isRemote = args.workplaceType === "remote" ? true : null;
  return {
    rawLocation: location ?? null,
    location: location
      ? /indonesia/i.test(location)
        ? location
        : `${location}, Indonesia`
      : isRemote
        ? "Remote, Indonesia"
        : "Indonesia",
    countryKey: "indonesia",
    country: "indonesia",
    city:
      location && !/indonesia/i.test(location)
        ? location.split(",")[0]?.trim()
        : undefined,
    workplaceType: args.workplaceType,
    isRemote,
    evidenceQuality: location ? "approximate" : "weak",
    source: "jobstreet",
    sourceNotes: ["JobStreet extractor is scoped to Indonesia."],
  };
}

export function mapJobStreetCardPayload(
  payload: JobStreetCardPayload,
): CreateJobInput | null {
  const jobUrl = normalizeJobStreetJobUrl(payload.jobUrl);
  if (!jobUrl) return null;

  const title = cleanText(payload.title);
  if (!title) return null;

  const location = cleanText(payload.location);
  const workplaceType = inferJobStreetWorkplaceType(
    payload.jobType,
    payload.location,
    payload.snippet,
    payload.text,
  );
  const description = truncateText(
    uniqueStrings([payload.snippet, payload.text]).join("\n\n"),
  );

  return {
    source: "jobstreet",
    sourceJobId: extractJobStreetSourceJobId(jobUrl),
    title,
    employer: cleanText(payload.employer) ?? "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    salary: cleanText(payload.salary),
    location,
    locationEvidence: buildLocationEvidence({ location, workplaceType }),
    datePosted: formatJobStreetPostedDate(payload.listedAt),
    jobDescription: description,
    jobType: cleanText(payload.jobType),
    jobFunction: cleanText(payload.classification),
    workFromHomeType: workplaceType,
    isRemote: workplaceType === "remote" ? true : undefined,
    companyLogo: getString(payload.companyLogo),
  };
}

export function dedupeJobStreetJobs(
  jobs: CreateJobInput[],
  existingJobUrls: readonly string[] = [],
): CreateJobInput[] {
  const existing = new Set(
    existingJobUrls.map((url) => normalizeJobStreetJobUrl(url) ?? url),
  );
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    const normalizedUrl = normalizeJobStreetJobUrl(job.jobUrl) ?? job.jobUrl;
    if (existing.has(normalizedUrl) || existing.has(job.jobUrl)) continue;

    const key = job.sourceJobId ?? normalizedUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...job, jobUrl: normalizedUrl });
  }

  return deduped;
}

function resolveRunLocations(
  locations: string[] | undefined,
): Array<string | undefined> {
  const normalized = (locations ?? [])
    .map((location) => location.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [undefined];
}

async function launchBrowser(): Promise<{
  browser: Browser;
  userAgent?: string;
}> {
  const storageDir = getCloudflareCookieStorageDir();
  const cookieJar = await readCookieJar(EXTRACTOR_ID, storageDir);
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  return { browser, userAgent: cookieJar.userAgent };
}

async function createContext(
  browser: Browser,
  userAgent?: string,
): Promise<BrowserContext> {
  const storageDir = getCloudflareCookieStorageDir();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(userAgent ? { userAgent } : {}),
  });
  await loadCookies(context, EXTRACTOR_ID, storageDir);
  return context;
}

async function navigateJobStreetPage(
  page: Page,
  url: string,
): Promise<{ challengeRequired?: string }> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  if (
    (response && isChallengeResponse(response)) ||
    (await isChallengePage(page))
  ) {
    const challenge = await waitForChallengeResolution(
      page,
      CHALLENGE_TIMEOUT_MS,
    );
    if (challenge.status === "passed") {
      await saveCookies(page.context(), EXTRACTOR_ID);
      return {};
    }

    await invalidateCookies(EXTRACTOR_ID);
    return { challengeRequired: url };
  }

  return {};
}

async function readEmptyPageError(page: Page): Promise<string | null> {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  const pageTitle = await page.title().catch(() => "");
  const text = `${pageTitle}\n${bodyText}`.toLowerCase();

  if (
    /no jobs|no matching jobs|tidak ada lowongan|tidak ditemukan|0\s+lowongan|0\s+jobs/.test(
      text,
    )
  ) {
    return null;
  }

  if (
    /just a moment|cloudflare|verify you are human|enable cookies|cf-mitigated/.test(
      text,
    )
  ) {
    return "JobStreet returned a Cloudflare challenge page without exposing public job cards.";
  }

  if (/\b(sign in|login|log in|masuk)\b/.test(text)) {
    return "JobStreet did not expose public job cards and appears to require a signed-in session.";
  }

  return "JobStreet search page did not expose public job cards. The public page structure may have changed.";
}

export async function extractJobStreetCardPayloadsFromPage(
  page: Page,
): Promise<JobStreetCardPayload[]> {
  const payloads = await page.evaluate(JOBSTREET_CARD_PAYLOAD_SCRIPT);
  return Array.isArray(payloads) ? (payloads as JobStreetCardPayload[]) : [];
}

async function collectJobStreetTermWithPage(params: {
  page: Page;
  searchTerm: string;
  location?: string;
  maxJobsPerTerm: number;
  existingJobUrls?: string[];
  shouldCancel?: () => boolean;
  onProgress?: Parameters<JobStreetTermCollector>[0]["onProgress"];
}): Promise<{
  jobs: CreateJobInput[];
  challengeRequired?: string;
  error?: string;
}> {
  const maxPages = Math.min(
    MAX_SEARCH_PAGES,
    Math.max(1, Math.ceil(params.maxJobsPerTerm / RESULTS_PER_PAGE_ESTIMATE)),
  );
  const existing = new Set(
    (params.existingJobUrls ?? []).map(
      (url) => normalizeJobStreetJobUrl(url) ?? url,
    ),
  );
  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    if (params.shouldCancel?.() || jobs.length >= params.maxJobsPerTerm) break;

    const searchUrl = makeJobStreetSearchUrl({
      keyword: params.searchTerm,
      location: params.location,
      page: pageNo,
    });
    const navigation = await navigateJobStreetPage(params.page, searchUrl);
    if (navigation.challengeRequired) {
      return { jobs, challengeRequired: navigation.challengeRequired };
    }

    await params.page.waitForTimeout(PAGE_SETTLE_MS);
    const payloads = await extractJobStreetCardPayloadsFromPage(params.page);
    if (payloads.length === 0) {
      if (pageNo === 1) {
        const error = await readEmptyPageError(params.page);
        if (error) return { jobs, error };
      }
      break;
    }

    let resultsOnPage = 0;
    for (const payload of payloads) {
      const mapped = mapJobStreetCardPayload(payload);
      if (!mapped) continue;
      const normalizedUrl =
        normalizeJobStreetJobUrl(mapped.jobUrl) ?? mapped.jobUrl;
      if (existing.has(normalizedUrl)) continue;
      const key = mapped.sourceJobId ?? normalizedUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(mapped);
      resultsOnPage += 1;
      if (jobs.length >= params.maxJobsPerTerm) break;
    }

    params.onProgress?.({
      type: "page_fetched",
      searchTerm: params.searchTerm,
      location: params.location,
      pageNo,
      resultsOnPage,
      totalCollected: jobs.length,
    });

    if (payloads.length < RESULTS_PER_PAGE_ESTIMATE / 2) break;
  }

  return { jobs };
}

export async function runJobStreetWithCollector(
  options: RunJobStreetOptions,
  collectTerm: JobStreetTermCollector,
): Promise<JobStreetResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : DEFAULT_SEARCH_TERMS;
  const locations = resolveRunLocations(options.locations);
  const maxJobsPerTerm = resolveJobStreetMaxJobsPerTerm(options.maxJobsPerTerm);
  const allJobs: CreateJobInput[] = [];
  const termTotal = searchTerms.length * locations.length;
  let termIndex = 0;

  for (const location of locations) {
    for (const searchTerm of searchTerms) {
      termIndex += 1;
      if (options.shouldCancel?.()) {
        return {
          success: true,
          jobs: dedupeJobStreetJobs(allJobs, options.existingJobUrls),
        };
      }

      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal,
        searchTerm,
        location,
      });

      const result = await collectTerm({
        searchTerm,
        location,
        maxJobsPerTerm,
        existingJobUrls: options.existingJobUrls,
        shouldCancel: options.shouldCancel,
        onProgress: (event) =>
          options.onProgress?.({
            ...event,
            termIndex,
            termTotal,
          }),
      });

      if (result.challengeRequired) {
        return {
          success: false,
          jobs: [],
          challengeRequired: result.challengeRequired,
        };
      }
      if (result.error) {
        return {
          success: false,
          jobs: [],
          error: result.error,
        };
      }

      allJobs.push(...result.jobs);
      options.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal,
        searchTerm,
        location,
        jobsFoundTerm: result.jobs.length,
      });
    }
  }

  return {
    success: true,
    jobs: dedupeJobStreetJobs(allJobs, options.existingJobUrls),
  };
}

export async function runJobStreet(
  options: RunJobStreetOptions = {},
): Promise<JobStreetResult> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    context = await createContext(browser, launched.userAgent);
    const page = await context.newPage();

    const result = await runJobStreetWithCollector(
      options,
      (collectorOptions) =>
        collectJobStreetTermWithPage({
          page,
          ...collectorOptions,
        }),
    );

    if (result.success) {
      await saveCookies(context, EXTRACTOR_ID);
    }

    return result;
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while running JobStreet extractor.",
    };
  } finally {
    await context?.close();
    await browser?.close();
  }
}
