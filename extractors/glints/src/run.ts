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

const EXTRACTOR_ID = "glints";
const GLINTS_BASE_URL = "https://glints.com";
const GLINTS_SEARCH_PATH = "/id/opportunities/jobs/explore";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const MAX_JOBS_PER_TERM = 1_000;
const DEFAULT_SEARCH_TERMS = ["software engineer"];
const MAX_SEARCH_PAGES = 5;
const MAX_SCROLL_ROUNDS = 12;
const NAVIGATION_TIMEOUT_MS = 60_000;
const CHALLENGE_TIMEOUT_MS = 30_000;
const SCROLL_DELAY_MS = 1_000;
const DETAIL_DELAY_MS = 300;

const GLINTS_JOB_PATH_RE =
  /^\/id(?:\/en)?\/opportunities\/jobs\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/)?$/i;

export type GlintsProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "list_page";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      totalLinks: number;
    }
  | {
      type: "job_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsProcessed: number;
      jobsFoundTerm: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

type GlintsTermProgressEvent =
  | {
      type: "list_page";
      searchTerm: string;
      pageNo: number;
      totalLinks: number;
    }
  | {
      type: "job_complete";
      searchTerm: string;
      jobsProcessed: number;
      jobsFoundTerm: number;
    };

export interface RunGlintsOptions {
  searchTerms?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: GlintsProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface GlintsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
  challengeRequired?: string;
}

interface GlintsTermCollectorOptions {
  searchTerm: string;
  maxJobsPerTerm: number;
  existingJobUrls?: string[];
  shouldCancel?: () => boolean;
  onProgress?: (event: GlintsTermProgressEvent) => void;
}

interface GlintsTermResult {
  jobs: CreateJobInput[];
  challengeRequired?: string;
}

type GlintsTermCollector = (
  options: GlintsTermCollectorOptions,
) => Promise<GlintsTermResult>;

interface GlintsJobDetail {
  jobUrl: string;
  sourceJobId?: string;
  title?: string;
  employer?: string;
  employerUrl?: string;
  salary?: string;
  location?: string;
  workplaceType?: "remote" | "hybrid" | "onsite";
  datePosted?: string;
  deadline?: string;
  jobDescription?: string;
  jobType?: string;
  skills?: string;
  companyLogo?: string;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith("#x")) {
      const parsed = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    if (key.startsWith("#")) {
      const parsed = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return named[key] ?? match;
  });
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function truncateText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trim()}...`
    : value;
}

export function resolveGlintsMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.min(MAX_JOBS_PER_TERM, Math.max(1, Math.floor(parsed)));
}

export function makeGlintsSearchUrl(args: {
  keyword: string;
  page?: number;
}): string {
  const url = new URL(GLINTS_SEARCH_PATH, GLINTS_BASE_URL);
  url.searchParams.set("countries", "id");
  url.searchParams.set("keyword", args.keyword);
  if (args.page && args.page > 1) {
    url.searchParams.set("page", String(Math.floor(args.page)));
  }
  return url.toString();
}

export function extractGlintsSourceJobId(value: string): string | undefined {
  try {
    const url = new URL(value, GLINTS_BASE_URL);
    if (url.hostname !== "glints.com") return undefined;
    return url.pathname.match(GLINTS_JOB_PATH_RE)?.[1];
  } catch {
    return undefined;
  }
}

export function normalizeGlintsJobUrl(value: string): string | null {
  try {
    const url = new URL(value, GLINTS_BASE_URL);
    if (url.hostname !== "glints.com") return null;
    const sourceJobId = extractGlintsSourceJobId(url.toString());
    if (!sourceJobId) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function extractGlintsJobUrlsFromHrefs(
  hrefs: readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const href of hrefs) {
    const normalized = normalizeGlintsJobUrl(href);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

function isJobPostingType(value: unknown): boolean {
  const values = toArray(value).map((item) => String(item).toLowerCase());
  return values.includes("jobposting");
}

function findJobPosting(
  value: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = toRecord(value);
  if (!record) return null;
  if (isJobPostingType(record["@type"])) return record;

  for (const key of ["@graph", "graph", "mainEntity", "itemListElement"]) {
    const found = findJobPosting(record[key], depth + 1);
    if (found) return found;
  }

  return null;
}

export function extractJsonLdJobPosting(
  scripts: readonly string[],
): Record<string, unknown> | null {
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as unknown;
      const posting = findJobPosting(parsed);
      if (posting) return posting;
    } catch {}
  }
  return null;
}

function getOrganizationName(value: unknown): string | undefined {
  const record = toRecord(value);
  if (!record) return getString(value);
  return getString(record.name);
}

function getOrganizationUrl(value: unknown): string | undefined {
  const record = toRecord(value);
  if (!record) return undefined;
  const sameAs = getString(record.sameAs);
  const url = getString(record.url);
  return sameAs ?? url;
}

function formatDate(value: unknown): string | undefined {
  const raw = getString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function formatAddressCountry(value: unknown): string | undefined {
  const record = toRecord(value);
  if (record) return getString(record.name) ?? getString(record.addressCountry);
  return getString(value);
}

function formatJsonLdLocation(value: unknown): string | undefined {
  const first = toArray(value)[0];
  const location = toRecord(first);
  if (!location) return getString(first);

  const address = toRecord(location.address);
  if (!address) return getString(location.name);

  const locality = getString(address.addressLocality);
  const region = getString(address.addressRegion);
  const country = formatAddressCountry(address.addressCountry);
  const parts = [locality, region].filter((part): part is string =>
    Boolean(part),
  );

  if (parts.length > 0) return parts.join(", ");
  return country && /indonesia|id/i.test(country) ? "Indonesia" : country;
}

function inferWorkplaceType(
  ...values: Array<string | undefined>
): "remote" | "hybrid" | "onsite" | undefined {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (/remote|work from home|wfh|telecommute/.test(text)) return "remote";
  if (/hybrid/.test(text)) return "hybrid";
  if (/on-site|onsite|kerja di kantor/.test(text)) return "onsite";
  return undefined;
}

function formatEmploymentType(value: unknown): string | undefined {
  const values = toArray(value)
    .map((item) => getString(item))
    .filter((item): item is string => Boolean(item));
  return values.length > 0 ? values.join(", ") : undefined;
}

function formatSkills(value: unknown): string | undefined {
  const values = toArray(value)
    .flatMap((item) =>
      typeof item === "string" ? item.split(",") : [getString(item)],
    )
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  return values.length > 0 ? [...new Set(values)].join(", ") : undefined;
}

function formatBaseSalary(value: unknown): string | undefined {
  const raw = getString(value);
  if (raw) return raw;

  const salary = toRecord(value);
  if (!salary) return undefined;
  const currency = getString(salary.currency);
  const salaryValue = toRecord(salary.value) ?? salary;
  const min = getNumber(salaryValue.minValue);
  const max = getNumber(salaryValue.maxValue);
  const exact = getNumber(salaryValue.value);
  const unitText = getString(salaryValue.unitText);

  let amount: string | undefined;
  if (min !== undefined && max !== undefined && min !== max) {
    amount = `${min}-${max}`;
  } else if (min !== undefined || max !== undefined || exact !== undefined) {
    amount = String(min ?? max ?? exact);
  }

  if (!amount) return undefined;
  return [currency, amount, unitText ? `/ ${unitText}` : undefined]
    .filter(Boolean)
    .join(" ");
}

export function extractGlintsDetailFromJsonLd(
  jobUrl: string,
  posting: Record<string, unknown>,
): GlintsJobDetail {
  const description = getString(posting.description);
  const location = formatJsonLdLocation(posting.jobLocation);
  const jobType = formatEmploymentType(posting.employmentType);
  const workplaceType = inferWorkplaceType(
    getString(posting.jobLocationType),
    jobType,
    description ? stripHtml(description) : undefined,
    location,
  );
  const image = toArray(posting.image)[0];
  const logo = toRecord(image)
    ? getString(toRecord(image)?.url)
    : getString(image);

  return {
    jobUrl,
    sourceJobId: extractGlintsSourceJobId(jobUrl),
    title: getString(posting.title),
    employer: getOrganizationName(posting.hiringOrganization),
    employerUrl: getOrganizationUrl(posting.hiringOrganization),
    salary: formatBaseSalary(posting.baseSalary),
    location,
    workplaceType,
    datePosted: formatDate(posting.datePosted),
    deadline: formatDate(posting.validThrough),
    jobDescription: description ? stripHtml(description) : undefined,
    jobType,
    skills: formatSkills(posting.skills),
    companyLogo: logo,
  };
}

function parseTitleAndEmployerFromPageTitle(
  pageTitle: string,
): Pick<GlintsJobDetail, "title" | "employer"> {
  const normalized = pageTitle.replace(/\s+/g, " ").trim();
  const english = normalized.match(/^(.+?)\s+Jobs at\s+(.+?)(?:\s*\||,|$)/i);
  if (english) {
    return { title: english[1]?.trim(), employer: english[2]?.trim() };
  }

  const indonesian = normalized.match(
    /^Lowongan\s+(.+?)\s+di\s+(.+?)(?:\s*\||,|$)/i,
  );
  if (indonesian) {
    return { title: indonesian[1]?.trim(), employer: indonesian[2]?.trim() };
  }

  return {};
}

export function extractGlintsDetailFromFallback(args: {
  jobUrl: string;
  pageTitle: string;
  bodyText: string;
}): GlintsJobDetail {
  const parsedTitle = parseTitleAndEmployerFromPageTitle(args.pageTitle);
  const bodyLines = args.bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstHeading = bodyLines[0];

  return {
    jobUrl: args.jobUrl,
    sourceJobId: extractGlintsSourceJobId(args.jobUrl),
    title: parsedTitle.title ?? firstHeading,
    employer: parsedTitle.employer,
    jobDescription: truncateText(args.bodyText.replace(/\s+\n/g, "\n"), 12_000),
    workplaceType: inferWorkplaceType(args.pageTitle, args.bodyText),
  };
}

function buildLocationEvidence(detail: GlintsJobDetail): JobLocationEvidence {
  const location = detail.location?.trim();
  const workplaceType = detail.workplaceType;
  const isRemote = workplaceType === "remote" ? true : null;
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
    workplaceType,
    isRemote,
    evidenceQuality: location ? "approximate" : "weak",
    source: "glints",
    sourceNotes: ["Glints extractor is scoped to Indonesia."],
  };
}

export function mapGlintsJobDetail(
  detail: GlintsJobDetail,
): CreateJobInput | null {
  const jobUrl = normalizeGlintsJobUrl(detail.jobUrl);
  if (!jobUrl) return null;

  const title = detail.title?.trim();
  if (!title) return null;

  return {
    source: "glints",
    sourceJobId: detail.sourceJobId ?? extractGlintsSourceJobId(jobUrl),
    title,
    employer: detail.employer?.trim() || "Unknown Employer",
    employerUrl: detail.employerUrl,
    jobUrl,
    applicationLink: jobUrl,
    salary: detail.salary,
    location: detail.location,
    locationEvidence: buildLocationEvidence(detail),
    deadline: detail.deadline,
    datePosted: detail.datePosted,
    jobDescription: truncateText(detail.jobDescription, 12_000),
    jobType: detail.jobType,
    workFromHomeType: detail.workplaceType,
    isRemote: detail.workplaceType === "remote" ? true : undefined,
    skills: detail.skills,
    companyLogo: detail.companyLogo,
  };
}

export function dedupeGlintsJobs(
  jobs: CreateJobInput[],
  existingJobUrls: readonly string[] = [],
): CreateJobInput[] {
  const existing = new Set(
    existingJobUrls.map((url) => normalizeGlintsJobUrl(url) ?? url),
  );
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    const normalizedUrl = normalizeGlintsJobUrl(job.jobUrl) ?? job.jobUrl;
    if (existing.has(normalizedUrl) || existing.has(job.jobUrl)) continue;
    const key = job.sourceJobId ?? normalizedUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...job, jobUrl: normalizedUrl });
  }

  return deduped;
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

async function navigateGlintsPage(
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

async function readJobHrefs(page: Page): Promise<string[]> {
  return await page.$$eval("a[href]", (anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean),
  );
}

async function collectJobLinksFromCurrentPage(
  page: Page,
  maxJobs: number,
): Promise<string[]> {
  const seen = new Set<string>();
  let stableRounds = 0;
  let previousCount = 0;
  let previousHeight = 0;

  for (
    let round = 0;
    round < MAX_SCROLL_ROUNDS && seen.size < maxJobs;
    round += 1
  ) {
    for (const url of extractGlintsJobUrlsFromHrefs(await readJobHrefs(page))) {
      seen.add(url);
      if (seen.size >= maxJobs) break;
    }

    const height = await page.evaluate(() => document.body.scrollHeight);
    if (seen.size === previousCount && height === previousHeight) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
    if (stableRounds >= 2) break;

    previousCount = seen.size;
    previousHeight = height;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(SCROLL_DELAY_MS);
  }

  return [...seen].slice(0, maxJobs);
}

async function clickNextPage(page: Page): Promise<boolean> {
  const nextCandidates = [
    page.getByRole("link", { name: /^(next|selanjutnya)$/i }),
    page.getByRole("button", { name: /^(next|selanjutnya)$/i }),
    page.locator("a:has-text('Next')"),
    page.locator("button:has-text('Next')"),
    page.locator("a:has-text('Selanjutnya')"),
    page.locator("button:has-text('Selanjutnya')"),
    page.locator("[aria-label*='Next' i]"),
  ];

  for (const locator of nextCandidates) {
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const first = locator.first();
    if (!(await first.isVisible().catch(() => false))) continue;
    await first.click({ timeout: 7_000 });
    await page.waitForTimeout(SCROLL_DELAY_MS);
    return true;
  }

  return false;
}

async function collectSearchLinks(params: {
  page: Page;
  searchTerm: string;
  maxJobsPerTerm: number;
  shouldCancel?: () => boolean;
  onProgress?: GlintsTermCollectorOptions["onProgress"];
}): Promise<{ urls: string[]; challengeRequired?: string }> {
  const searchUrl = makeGlintsSearchUrl({ keyword: params.searchTerm });
  const navigation = await navigateGlintsPage(params.page, searchUrl);
  if (navigation.challengeRequired) {
    return { urls: [], challengeRequired: navigation.challengeRequired };
  }

  const seen = new Set<string>();
  for (let pageNo = 1; pageNo <= MAX_SEARCH_PAGES; pageNo += 1) {
    if (params.shouldCancel?.() || seen.size >= params.maxJobsPerTerm) break;

    const pageLinks = await collectJobLinksFromCurrentPage(
      params.page,
      params.maxJobsPerTerm - seen.size,
    );
    for (const url of pageLinks) seen.add(url);
    params.onProgress?.({
      type: "list_page",
      searchTerm: params.searchTerm,
      pageNo,
      totalLinks: seen.size,
    });

    if (seen.size >= params.maxJobsPerTerm) break;
    const clicked = await clickNextPage(params.page);
    if (!clicked) break;

    const challenge = await navigateGlintsPage(params.page, params.page.url());
    if (challenge.challengeRequired) {
      return {
        urls: [...seen],
        challengeRequired: challenge.challengeRequired,
      };
    }
  }

  return { urls: [...seen].slice(0, params.maxJobsPerTerm) };
}

async function readGlintsDetailPage(
  page: Page,
  jobUrl: string,
): Promise<{ detail?: GlintsJobDetail; challengeRequired?: string }> {
  const navigation = await navigateGlintsPage(page, jobUrl);
  if (navigation.challengeRequired) {
    return { challengeRequired: navigation.challengeRequired };
  }

  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
    .catch(() => []);
  const jsonLd = extractJsonLdJobPosting(scripts);
  if (jsonLd) {
    return { detail: extractGlintsDetailFromJsonLd(jobUrl, jsonLd) };
  }

  const pageTitle = await page.title().catch(() => "");
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");

  return {
    detail: extractGlintsDetailFromFallback({ jobUrl, pageTitle, bodyText }),
  };
}

async function collectGlintsTermWithPage(params: {
  page: Page;
  searchTerm: string;
  maxJobsPerTerm: number;
  existingJobUrls?: string[];
  shouldCancel?: () => boolean;
  onProgress?: GlintsTermCollectorOptions["onProgress"];
}): Promise<GlintsTermResult> {
  const search = await collectSearchLinks({
    page: params.page,
    searchTerm: params.searchTerm,
    maxJobsPerTerm: params.maxJobsPerTerm,
    shouldCancel: params.shouldCancel,
    onProgress: params.onProgress,
  });
  if (search.challengeRequired) {
    return { jobs: [], challengeRequired: search.challengeRequired };
  }

  const existing = new Set(
    (params.existingJobUrls ?? []).map(
      (url) => normalizeGlintsJobUrl(url) ?? url,
    ),
  );
  const jobs: CreateJobInput[] = [];
  let processed = 0;

  for (const jobUrl of search.urls) {
    if (params.shouldCancel?.() || jobs.length >= params.maxJobsPerTerm) break;
    if (existing.has(jobUrl)) continue;

    const detail = await readGlintsDetailPage(params.page, jobUrl);
    if (detail.challengeRequired) {
      return { jobs, challengeRequired: detail.challengeRequired };
    }

    const mapped = detail.detail ? mapGlintsJobDetail(detail.detail) : null;
    if (mapped) jobs.push(mapped);
    processed += 1;
    params.onProgress?.({
      type: "job_complete",
      searchTerm: params.searchTerm,
      jobsProcessed: processed,
      jobsFoundTerm: jobs.length,
    });
    await params.page.waitForTimeout(DETAIL_DELAY_MS);
  }

  return { jobs };
}

export async function runGlintsWithCollector(
  options: RunGlintsOptions,
  collectTerm: GlintsTermCollector,
): Promise<GlintsResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : DEFAULT_SEARCH_TERMS;
  const maxJobsPerTerm = resolveGlintsMaxJobsPerTerm(options.maxJobsPerTerm);
  const allJobs: CreateJobInput[] = [];
  const termTotal = searchTerms.length;

  for (let index = 0; index < searchTerms.length; index += 1) {
    const termIndex = index + 1;
    const searchTerm = searchTerms[index] ?? "";
    if (options.shouldCancel?.()) {
      return {
        success: true,
        jobs: dedupeGlintsJobs(allJobs, options.existingJobUrls),
      };
    }

    options.onProgress?.({
      type: "term_start",
      termIndex,
      termTotal,
      searchTerm,
    });

    const result = await collectTerm({
      searchTerm,
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

    allJobs.push(...result.jobs);
    options.onProgress?.({
      type: "term_complete",
      termIndex,
      termTotal,
      searchTerm,
      jobsFoundTerm: result.jobs.length,
    });
  }

  return {
    success: true,
    jobs: dedupeGlintsJobs(allJobs, options.existingJobUrls),
  };
}

export async function runGlints(
  options: RunGlintsOptions = {},
): Promise<GlintsResult> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    context = await createContext(browser, launched.userAgent);
    const page = await context.newPage();

    const result = await runGlintsWithCollector(options, (collectorOptions) =>
      collectGlintsTermWithPage({
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
          : "Unexpected error while running Glints extractor.",
    };
  } finally {
    await context?.close();
    await browser?.close();
  }
}
