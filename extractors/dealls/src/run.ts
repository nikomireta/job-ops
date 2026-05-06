import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";

const DEALLS_BASE_URL = "https://dealls.com";
const DEALLS_API_BASE_URL = "https://api.sejutacita.id";
const DEALLS_SEARCH_PATH = "/v1/explore-job/job";
const DEALLS_DETAIL_PATH = "/v1/job-portal/job";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const MAX_JOBS_PER_TERM = 1_000;
const DEFAULT_SEARCH_TERMS = ["software engineer"];
const PAGE_LIMIT = 18;
const DESCRIPTION_MAX_LENGTH = 12_000;
const MAX_FALLBACK_SEARCH_TERMS_PER_TERM = 4;

const DEALLS_JOB_PATH_RE = /^\/loker\/([^/?#~]+)~([^/?#]+)\/?$/i;
const DEALLS_HOSTS = new Set(["dealls.com", "www.dealls.com"]);

export type DeallsProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      resultsOnPage: number;
      totalCollected: number;
    }
  | {
      type: "job_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      totalCollected: number;
      jobUrl: string;
    }
  | {
      type: "term_fallback";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      fallbackSearchTerms: string[];
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunDeallsOptions {
  searchTerms?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: DeallsProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface DeallsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface DeallsSearchPage {
  page: number;
  totalPages: number;
  totalDocs: number;
  jobs: Record<string, unknown>[];
}

type FetchLike = typeof fetch;

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
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
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|section|article|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
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

function formatDate(value: unknown): string | undefined {
  const raw = getString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function getIdString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return getString(value);
}

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "job";
}

function normalizeFallbackSearchTerm(value: string): string | null {
  const normalized = value
    .replace(/\bci\s*\/\s*cd\b/gi, "ci cd")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3) return null;
  const lower = normalized.toLowerCase();
  if (lower === "aws" || lower === "ec2") return null;
  return normalized;
}

function addFallbackSearchTerm(
  out: string[],
  seen: Set<string>,
  value: string,
): void {
  const normalized = normalizeFallbackSearchTerm(value);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(normalized);
}

export function deriveDeallsFallbackSearchTerms(searchTerm: string): string[] {
  const normalizedOriginal =
    normalizeFallbackSearchTerm(searchTerm) ?? searchTerm.trim();
  const seen = new Set([normalizedOriginal.toLowerCase()]);
  const out: string[] = [];
  const lower = searchTerm.toLowerCase();

  if (/\bdev\s*ops\b|\bdevops\b|\bci\s*\/?\s*cd\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "DevOps");
    addFallbackSearchTerm(out, seen, "site reliability engineer");
  }
  if (/\bcloud\b|\baws\b|\bec2\b|\balibaba\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "cloud engineer");
  }
  if (/\bsoftware\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "software engineer");
  }
  if (/\bbackend\b|\bback[\s-]?end\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "backend engineer");
  }
  if (/\bfrontend\b|\bfront[\s-]?end\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "frontend engineer");
  }
  if (/\blinux\b|\bsystem\b|\bserver\b/.test(lower)) {
    addFallbackSearchTerm(out, seen, "DevOps");
  }

  const splitInput = searchTerm.replace(/\bci\s*\/\s*cd\b/gi, "CI CD");
  for (const part of splitInput.split(/[/&,()]+/)) {
    addFallbackSearchTerm(out, seen, part);
  }

  return out.slice(0, MAX_FALLBACK_SEARCH_TERMS_PER_TERM);
}

export function resolveDeallsMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.min(MAX_JOBS_PER_TERM, Math.max(1, Math.floor(parsed)));
}

export function makeDeallsSearchUrl(args: {
  keyword: string;
  page?: number;
  limit?: number;
}): string {
  const url = new URL(DEALLS_SEARCH_PATH, DEALLS_API_BASE_URL);
  url.searchParams.set("published", "true");
  url.searchParams.set("status", "active");
  url.searchParams.set("sortParam", "mostRelevant");
  url.searchParams.set("sortBy", "asc");
  url.searchParams.set("externalPlatformApplyUrlSet", "null");
  url.searchParams.set("boostTheBoostedJob", "true");
  url.searchParams.set("limit", String(args.limit ?? PAGE_LIMIT));
  url.searchParams.set("page", String(Math.max(1, args.page ?? 1)));
  url.searchParams.set("search", args.keyword);
  return url.toString();
}

export function makeDeallsRefererUrl(keyword: string): string {
  const url = new URL("/", DEALLS_BASE_URL);
  url.searchParams.set("search", keyword);
  return url.toString();
}

export function getDeallsSearchHeaders(keyword: string): HeadersInit {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "id-ID,id;q=0.9,en;q=0.8",
    origin: DEALLS_BASE_URL,
    referer: makeDeallsRefererUrl(keyword),
  };
}

export function buildDeallsJobUrl(args: {
  jobSlug: string;
  companySlug: string;
}): string {
  return `${DEALLS_BASE_URL}/loker/${args.jobSlug}~${args.companySlug}`;
}

export function normalizeDeallsJobUrl(value: string): string | null {
  try {
    const url = new URL(value, DEALLS_BASE_URL);
    if (!DEALLS_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(DEALLS_JOB_PATH_RE);
    if (!match) return null;
    const [, jobSlug, companySlug] = match;
    if (!jobSlug || !companySlug) return null;
    return buildDeallsJobUrl({ jobSlug, companySlug });
  } catch {
    return null;
  }
}

export function parseDeallsSearchPayload(value: unknown): DeallsSearchPage {
  const record = toRecord(value);
  const data = toRecord(record?.data);
  if (!record || !data) {
    throw new Error("Dealls search response was not an object.");
  }

  const jobs = toArray(data.docs).filter(
    (job): job is Record<string, unknown> => Boolean(toRecord(job)),
  );
  return {
    page: getNumber(data.page) ?? 1,
    totalPages: getNumber(data.totalPages) ?? (jobs.length > 0 ? 1 : 0),
    totalDocs: getNumber(data.totalDocs) ?? jobs.length,
    jobs,
  };
}

export function parseDeallsDetailPayload(
  value: unknown,
): Record<string, unknown> | null {
  const record = toRecord(value);
  const result = toRecord(toRecord(record?.data)?.result);
  return result ?? null;
}

function getCountry(job: Record<string, unknown>): Record<string, unknown> {
  return toRecord(job.country) ?? {};
}

function getCity(job: Record<string, unknown>): Record<string, unknown> {
  return toRecord(job.city) ?? {};
}

export function isIndonesiaDeallsJob(job: Record<string, unknown>): boolean {
  const country = getCountry(job);
  const countryName = getString(country.name);
  const countryId = getNumber(country.id);
  return countryName?.toLowerCase() === "indonesia" || countryId === 102;
}

function chooseJobRecord(
  job: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): Record<string, unknown> {
  return detail && Object.keys(detail).length > 0 ? { ...job, ...detail } : job;
}

function getCompany(
  job: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): Record<string, unknown> {
  return (
    toRecord(detail?.company) ??
    toRecord(job.company) ??
    toRecord(toRecord(detail?.job)?.company) ??
    {}
  );
}

function formatLocation(job: Record<string, unknown>): {
  rawLocation?: string;
  location: string;
  city?: string;
  country?: string;
} {
  const city = getString(getCity(job).name);
  const country = getString(getCountry(job).name) ?? "Indonesia";
  const rawLocation = city ? `${city}, ${country}` : country;
  return {
    rawLocation,
    location: rawLocation,
    city,
    country,
  };
}

function inferWorkplaceType(
  job: Record<string, unknown>,
): "remote" | "hybrid" | "onsite" {
  const raw = getString(job.workplaceType)?.toLowerCase() ?? "";
  if (raw.includes("remote")) return "remote";
  if (raw.includes("hybrid")) return "hybrid";
  return "onsite";
}

function formatSalary(job: Record<string, unknown>): {
  salary?: string;
  min?: number;
  max?: number;
  interval?: string;
  currency?: string;
} {
  const salaryRange = toRecord(job.salaryRange);
  const min = getNumber(salaryRange?.start);
  const max = getNumber(salaryRange?.end);
  if (min === undefined && max === undefined) return {};

  const currency = getString(job.salaryCurrency) ?? "IDR";
  const interval = getString(job.salaryType);
  const amount =
    min !== undefined && max !== undefined && min !== max
      ? `${min}-${max}`
      : String(min ?? max);

  return {
    salary: [currency, amount, interval ? `/ ${interval}` : undefined]
      .filter(Boolean)
      .join(" "),
    min,
    max,
    interval,
    currency,
  };
}

function formatTextSection(value: unknown): string | undefined {
  const parts = toArray(value)
    .map((item) => {
      if (typeof item === "string") return item;
      return getString(toRecord(item)?.name) ?? getString(toRecord(item)?.text);
    })
    .filter((item): item is string => Boolean(item))
    .map(stripHtml)
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function formatDescription(job: Record<string, unknown>): string | undefined {
  const sections: string[] = [];
  const responsibilities = formatTextSection(job.responsibilities);
  const requirements = formatTextSection(job.requirements);
  const perks = formatTextSection(job.perks);
  const description = formatTextSection(job.description);

  if (responsibilities) {
    sections.push(`Responsibilities\n${responsibilities}`);
  }
  if (requirements) {
    sections.push(`Requirements\n${requirements}`);
  }
  if (perks) {
    sections.push(`Perks\n${perks}`);
  }
  if (sections.length === 0 && description) {
    sections.push(`Description\n${description}`);
  }

  return truncateText(sections.join("\n\n"), DESCRIPTION_MAX_LENGTH);
}

function formatSkills(job: Record<string, unknown>): string | undefined {
  const values = toArray(job.skills)
    .map((item) => getString(toRecord(item)?.name) ?? getString(item))
    .filter((item): item is string => Boolean(item));
  return values.length > 0 ? [...new Set(values)].join(", ") : undefined;
}

function formatJobType(job: Record<string, unknown>): string | undefined {
  const values = toArray(job.employmentTypes)
    .map((item) => getString(item) ?? getString(toRecord(item)?.name))
    .filter((item): item is string => Boolean(item));
  return values.length > 0 ? [...new Set(values)].join(", ") : undefined;
}

function buildLocationEvidence(
  job: Record<string, unknown>,
  workplaceType: "remote" | "hybrid" | "onsite",
): JobLocationEvidence {
  const location = formatLocation(job);
  return {
    rawLocation: location.rawLocation ?? null,
    location: location.location,
    countryKey: "indonesia",
    country: "indonesia",
    city: location.city,
    workplaceType,
    isRemote: workplaceType === "remote",
    isHybrid: workplaceType === "hybrid",
    evidenceQuality: location.city ? "approximate" : "weak",
    source: "dealls",
    sourceNotes: ["Dealls extractor is scoped to Indonesia."],
  };
}

export function mapDeallsJob(
  job: Record<string, unknown>,
  detail?: Record<string, unknown> | null,
): CreateJobInput | null {
  if (!isIndonesiaDeallsJob(job)) return null;

  const merged = chooseJobRecord(job, detail);
  const id = getIdString(job.id);
  const jobSlug = getString(job.slug) ?? getString(merged.slug);
  const company = getCompany(job, detail);
  const employer = getString(company.name) ?? "Unknown Employer";
  const companySlug = getString(company.slug) ?? slugify(employer);
  const title = getString(merged.role ?? job.role);
  if (!id || !jobSlug || !companySlug || !title) return null;

  const jobUrl = buildDeallsJobUrl({ jobSlug, companySlug });
  const workplaceType = inferWorkplaceType(merged);
  const location = formatLocation(merged);
  const externalApplyUrl =
    getString(merged.externalPlatformApplyUrl) ??
    getString(job.externalPlatformApplyUrl);
  const salary = formatSalary(merged);

  return {
    source: "dealls",
    sourceJobId: id,
    title,
    employer,
    employerUrl: `${DEALLS_BASE_URL}/companies/${companySlug}`,
    jobUrl,
    applicationLink: isValidHttpUrl(externalApplyUrl)
      ? externalApplyUrl
      : jobUrl,
    salary: salary.salary,
    location: location.rawLocation,
    locationEvidence: buildLocationEvidence(merged, workplaceType),
    datePosted: formatDate(merged.publishedAt ?? merged.createdAt),
    jobDescription: formatDescription(merged),
    jobType: formatJobType(merged),
    salaryInterval: salary.interval,
    salaryMinAmount: salary.min,
    salaryMaxAmount: salary.max,
    salaryCurrency: salary.currency,
    isRemote: workplaceType === "remote" ? true : undefined,
    companyIndustry: getString(company.sector),
    companyLogo: getString(company.logoUrl),
    companyUrlDirect: isValidHttpUrl(getString(company.website))
      ? getString(company.website)
      : undefined,
    companyDescription: getString(company.description),
    skills: formatSkills(merged),
    workFromHomeType: workplaceType,
  };
}

export function dedupeDeallsJobs(
  jobs: CreateJobInput[],
  existingJobUrls: readonly string[] = [],
): CreateJobInput[] {
  const existing = new Set(
    existingJobUrls.map((url) => normalizeDeallsJobUrl(url) ?? url),
  );
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    const normalizedUrl = normalizeDeallsJobUrl(job.jobUrl) ?? job.jobUrl;
    if (existing.has(normalizedUrl) || existing.has(job.jobUrl)) continue;
    const key = job.sourceJobId
      ? `id:${job.sourceJobId}`
      : `url:${normalizedUrl}`;
    const urlKey = `url:${normalizedUrl}`;
    if (seen.has(key) || seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);
    deduped.push({ ...job, jobUrl: normalizedUrl });
  }

  return deduped;
}

function getDeallsJobDedupeKeys(job: CreateJobInput): string[] {
  const normalizedUrl = normalizeDeallsJobUrl(job.jobUrl) ?? job.jobUrl;
  return [
    job.sourceJobId ? `id:${job.sourceJobId}` : null,
    `url:${normalizedUrl}`,
  ].filter((key): key is string => Boolean(key));
}

function rememberDeallsJob(seen: Set<string>, job: CreateJobInput): boolean {
  const keys = getDeallsJobDedupeKeys(job);
  if (keys.some((key) => seen.has(key))) return false;
  for (const key of keys) seen.add(key);
  return true;
}

async function fetchDeallsSearchPage(args: {
  fetchImpl: FetchLike;
  searchTerm: string;
  pageNo: number;
}): Promise<DeallsSearchPage> {
  const url = makeDeallsSearchUrl({
    keyword: args.searchTerm,
    page: args.pageNo,
    limit: PAGE_LIMIT,
  });
  const response = await args.fetchImpl(url, {
    headers: getDeallsSearchHeaders(args.searchTerm),
  });

  if (!response.ok) {
    throw new Error(
      `Dealls search request failed with HTTP ${response.status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new Error("Dealls search response was not valid JSON.");
  }

  return parseDeallsSearchPayload(parsed);
}

async function fetchDeallsDetail(args: {
  fetchImpl: FetchLike;
  id: string;
  searchTerm: string;
}): Promise<Record<string, unknown> | null> {
  const response = await args.fetchImpl(
    `${DEALLS_API_BASE_URL}${DEALLS_DETAIL_PATH}/${encodeURIComponent(args.id)}`,
    {
      headers: getDeallsSearchHeaders(args.searchTerm),
    },
  );

  if (!response.ok) return null;

  try {
    return parseDeallsDetailPayload(
      JSON.parse(await response.text()) as unknown,
    );
  } catch {
    return null;
  }
}

export async function runDeallsWithFetcher(
  options: RunDeallsOptions,
  fetchImpl: FetchLike,
): Promise<DeallsResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : DEFAULT_SEARCH_TERMS;
  const maxJobsPerTerm = resolveDeallsMaxJobsPerTerm(options.maxJobsPerTerm);
  const allJobs: CreateJobInput[] = [];
  const termTotal = searchTerms.length;

  try {
    for (let index = 0; index < searchTerms.length; index += 1) {
      const termIndex = index + 1;
      const searchTerm = searchTerms[index] ?? "";
      if (options.shouldCancel?.()) {
        return {
          success: true,
          jobs: dedupeDeallsJobs(allJobs, options.existingJobUrls),
        };
      }

      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal,
        searchTerm,
      });

      const termJobs: CreateJobInput[] = [];
      const termSeenJobKeys = new Set<string>();
      const searchTermsForGroup = [searchTerm];

      for (
        let searchIndex = 0;
        !options.shouldCancel?.() &&
        searchIndex < searchTermsForGroup.length &&
        termJobs.length < maxJobsPerTerm;
        searchIndex += 1
      ) {
        const activeSearchTerm = searchTermsForGroup[searchIndex] ?? "";
        let pageNo = 1;
        let totalPages = Number.POSITIVE_INFINITY;
        let firstPageResults: number | null = null;

        while (
          !options.shouldCancel?.() &&
          termJobs.length < maxJobsPerTerm &&
          pageNo <= totalPages
        ) {
          const page = await fetchDeallsSearchPage({
            fetchImpl,
            searchTerm: activeSearchTerm,
            pageNo,
          });
          totalPages = page.totalPages;
          if (pageNo === 1) {
            firstPageResults = page.jobs.length;
          }

          options.onProgress?.({
            type: "page_fetched",
            termIndex,
            termTotal,
            searchTerm: activeSearchTerm,
            pageNo,
            resultsOnPage: page.jobs.length,
            totalCollected: termJobs.length,
          });

          for (const rawJob of page.jobs) {
            if (options.shouldCancel?.() || termJobs.length >= maxJobsPerTerm) {
              break;
            }
            if (!isIndonesiaDeallsJob(rawJob)) continue;

            const id = getIdString(rawJob.id);
            const detail = id
              ? await fetchDeallsDetail({
                  fetchImpl,
                  id,
                  searchTerm: activeSearchTerm,
                })
              : null;
            const mapped = mapDeallsJob(rawJob, detail);
            if (!mapped || !rememberDeallsJob(termSeenJobKeys, mapped)) {
              continue;
            }

            termJobs.push(mapped);
            options.onProgress?.({
              type: "job_complete",
              termIndex,
              termTotal,
              searchTerm: activeSearchTerm,
              totalCollected: termJobs.length,
              jobUrl: mapped.jobUrl,
            });
          }

          if (page.jobs.length === 0) break;
          pageNo += 1;
        }

        if (
          searchIndex === 0 &&
          firstPageResults === 0 &&
          termJobs.length === 0 &&
          !options.shouldCancel?.()
        ) {
          const fallbackSearchTerms =
            deriveDeallsFallbackSearchTerms(searchTerm);
          if (fallbackSearchTerms.length > 0) {
            searchTermsForGroup.push(...fallbackSearchTerms);
            options.onProgress?.({
              type: "term_fallback",
              termIndex,
              termTotal,
              searchTerm,
              fallbackSearchTerms,
            });
          }
        }
      }

      allJobs.push(...termJobs);
      options.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal,
        searchTerm,
        jobsFoundTerm: termJobs.length,
      });
    }

    return {
      success: true,
      jobs: dedupeDeallsJobs(allJobs, options.existingJobUrls),
    };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while running Dealls extractor.",
    };
  }
}

export async function runDealls(
  options: RunDeallsOptions = {},
): Promise<DeallsResult> {
  return runDeallsWithFetcher(options, fetch);
}
