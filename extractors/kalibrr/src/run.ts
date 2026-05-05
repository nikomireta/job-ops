import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";

const KALIBRR_BASE_URL = "https://www.kalibrr.com";
const KALIBRR_SEARCH_PATH = "/kjs/job_board/search";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const MAX_JOBS_PER_TERM = 1_000;
const DEFAULT_SEARCH_TERMS = ["software engineer"];
const PAGE_LIMIT = 15;
const DESCRIPTION_MAX_LENGTH = 12_000;

const KALIBRR_JOB_PATH_RE =
  /^\/(?:id-ID\/)?c\/([^/]+)\/jobs\/(\d+)\/([^/?#]+)\/?$/i;
const KALIBRR_HOSTS = new Set([
  "www.kalibrr.com",
  "kalibrr.com",
  "www.kalibrr.id",
  "kalibrr.id",
]);

export type KalibrrProgressEvent =
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
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunKalibrrOptions {
  searchTerms?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: KalibrrProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface KalibrrResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface KalibrrSearchPage {
  count: number;
  jobs: Record<string, unknown>[];
}

type FetchLike = typeof fetch;

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

function slugifyTerm(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "software-engineer";
}

export function resolveKalibrrMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.min(MAX_JOBS_PER_TERM, Math.max(1, Math.floor(parsed)));
}

export function makeKalibrrSearchUrl(args: {
  keyword: string;
  offset?: number;
  limit?: number;
}): string {
  const url = new URL(KALIBRR_SEARCH_PATH, KALIBRR_BASE_URL);
  url.searchParams.set("limit", String(args.limit ?? PAGE_LIMIT));
  url.searchParams.set("offset", String(Math.max(0, args.offset ?? 0)));
  url.searchParams.set("text", args.keyword);
  return url.toString();
}

export function makeKalibrrRefererUrl(keyword: string): string {
  return `${KALIBRR_BASE_URL}/id-ID/home/te/${slugifyTerm(keyword)}`;
}

export function getKalibrrSearchHeaders(keyword: string): HeadersInit {
  return {
    accept: "application/json, text/plain, */*",
    referer: makeKalibrrRefererUrl(keyword),
  };
}

export function buildKalibrrJobUrl(args: {
  companyCode: string;
  id: string | number;
  slug: string;
}): string {
  return `${KALIBRR_BASE_URL}/id-ID/c/${args.companyCode}/jobs/${args.id}/${args.slug}`;
}

export function extractKalibrrSourceJobId(value: string): string | undefined {
  try {
    const url = new URL(value, KALIBRR_BASE_URL);
    if (!KALIBRR_HOSTS.has(url.hostname)) return undefined;
    return url.pathname.match(KALIBRR_JOB_PATH_RE)?.[2];
  } catch {
    return undefined;
  }
}

export function normalizeKalibrrJobUrl(value: string): string | null {
  try {
    const url = new URL(value, KALIBRR_BASE_URL);
    if (!KALIBRR_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(KALIBRR_JOB_PATH_RE);
    if (!match) return null;
    const [, companyCode, id, slug] = match;
    if (!companyCode || !id || !slug) return null;
    return buildKalibrrJobUrl({ companyCode, id, slug });
  } catch {
    return null;
  }
}

export function parseKalibrrSearchPayload(value: unknown): KalibrrSearchPage {
  const record = toRecord(value);
  if (!record) {
    throw new Error("Kalibrr search response was not an object.");
  }

  const jobs = toArray(record.jobs).filter(
    (job): job is Record<string, unknown> => Boolean(toRecord(job)),
  );
  const count = getNumber(record.count) ?? jobs.length;
  return { count, jobs };
}

function getAddressComponents(
  job: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return toRecord(toRecord(job.google_location)?.address_components);
}

export function isIndonesiaKalibrrJob(job: Record<string, unknown>): boolean {
  const country = getString(getAddressComponents(job)?.country);
  if (!country) return false;
  const normalized = country.trim().toLowerCase();
  return normalized === "id" || normalized === "indonesia";
}

function formatLocation(job: Record<string, unknown>): {
  rawLocation?: string;
  location: string;
  city?: string;
  region?: string;
} {
  const address = getAddressComponents(job);
  const city = getString(address?.city);
  const region = getString(address?.region);
  const parts = [city, region].filter((part): part is string => Boolean(part));
  const rawLocation = parts.length > 0 ? parts.join(", ") : undefined;
  return {
    rawLocation,
    location: rawLocation ? `${rawLocation}, Indonesia` : "Indonesia",
    city,
    region,
  };
}

function inferWorkplaceType(
  job: Record<string, unknown>,
): "remote" | "hybrid" | "onsite" {
  if (getBoolean(job.is_work_from_home)) return "remote";
  if (getBoolean(job.is_hybrid)) return "hybrid";
  return "onsite";
}

function formatSalary(job: Record<string, unknown>): string | undefined {
  if (getBoolean(job.salary_shown) === false) return undefined;

  const min = getNumber(job.base_salary);
  const max = getNumber(job.maximum_salary);
  if (min === undefined && max === undefined) return undefined;

  const currency = getString(job.salary_currency);
  const interval = getString(job.salary_interval);
  const amount =
    min !== undefined && max !== undefined && min !== max
      ? `${min}-${max}`
      : String(min ?? max);

  return [currency, amount, interval ? `/ ${interval}` : undefined]
    .filter(Boolean)
    .join(" ");
}

function formatDescription(job: Record<string, unknown>): string | undefined {
  const description = getString(job.description);
  const qualifications = getString(job.qualifications);
  const sections: string[] = [];

  if (description) {
    sections.push(`Description\n${stripHtml(description)}`);
  }
  if (qualifications) {
    sections.push(`Qualifications\n${stripHtml(qualifications)}`);
  }

  return truncateText(sections.join("\n\n"), DESCRIPTION_MAX_LENGTH);
}

function formatSkills(job: Record<string, unknown>): string | undefined {
  const values = toArray(job.job_sds_skills)
    .map((item) => getString(toRecord(toRecord(item)?.sds_skill)?.name))
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
    regionHints: location.region ? [location.region] : undefined,
    workplaceType,
    isRemote: workplaceType === "remote",
    isHybrid: workplaceType === "hybrid",
    evidenceQuality: location.rawLocation ? "approximate" : "weak",
    source: "kalibrr",
    sourceNotes: ["Kalibrr extractor is scoped to Indonesia."],
  };
}

export function mapKalibrrJob(
  job: Record<string, unknown>,
): CreateJobInput | null {
  if (!isIndonesiaKalibrrJob(job)) return null;

  const id = getIdString(job.id);
  const slug = getString(job.slug);
  const company = toRecord(job.company);
  const companyInfo = toRecord(job.company_info);
  const companyCode = getString(company?.code) ?? getString(companyInfo?.code);
  const title = getString(job.name);
  if (!id || !slug || !companyCode || !title) return null;

  const jobUrl = buildKalibrrJobUrl({ companyCode, id, slug });
  const workplaceType = inferWorkplaceType(job);
  const location = formatLocation(job);
  const applyRedirectUrl = getString(job.apply_redirect_url);
  const companyUrl = getString(companyInfo?.url);
  const salaryVisible = getBoolean(job.salary_shown) !== false;

  return {
    source: "kalibrr",
    sourceJobId: id,
    title,
    employer:
      getString(job.company_name) ??
      getString(company?.name) ??
      getString(companyInfo?.name) ??
      "Unknown Employer",
    employerUrl: `${KALIBRR_BASE_URL}/id-ID/c/${companyCode}/jobs`,
    jobUrl,
    applicationLink: isValidHttpUrl(applyRedirectUrl)
      ? applyRedirectUrl
      : jobUrl,
    salary: formatSalary(job),
    location: location.rawLocation,
    locationEvidence: buildLocationEvidence(job, workplaceType),
    deadline: formatDate(job.application_end_date),
    datePosted: formatDate(job.activation_date ?? job.created_at),
    jobDescription: formatDescription(job),
    jobType: getString(job.tenure),
    salaryInterval: salaryVisible ? getString(job.salary_interval) : undefined,
    salaryMinAmount: salaryVisible ? getNumber(job.base_salary) : undefined,
    salaryMaxAmount: salaryVisible ? getNumber(job.maximum_salary) : undefined,
    salaryCurrency: salaryVisible ? getString(job.salary_currency) : undefined,
    isRemote: workplaceType === "remote" ? true : undefined,
    jobFunction: getString(job.function),
    companyIndustry:
      getString(companyInfo?.industry) ?? getString(company?.industry),
    companyLogo:
      getString(companyInfo?.logo_small) ??
      getString(company?.logo_small) ??
      getString(companyInfo?.logo),
    companyUrlDirect: isValidHttpUrl(companyUrl) ? companyUrl : undefined,
    companyDescription:
      getString(companyInfo?.description) ?? getString(company?.description),
    skills: formatSkills(job),
    vacancyCount: getNumber(job.number_of_openings),
    workFromHomeType: workplaceType,
  };
}

export function dedupeKalibrrJobs(
  jobs: CreateJobInput[],
  existingJobUrls: readonly string[] = [],
): CreateJobInput[] {
  const existing = new Set(
    existingJobUrls.map((url) => normalizeKalibrrJobUrl(url) ?? url),
  );
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    const normalizedUrl = normalizeKalibrrJobUrl(job.jobUrl) ?? job.jobUrl;
    if (existing.has(normalizedUrl) || existing.has(job.jobUrl)) continue;
    const key = job.sourceJobId ?? normalizedUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...job, jobUrl: normalizedUrl });
  }

  return deduped;
}

async function fetchKalibrrSearchPage(args: {
  fetchImpl: FetchLike;
  searchTerm: string;
  offset: number;
}): Promise<KalibrrSearchPage> {
  const url = makeKalibrrSearchUrl({
    keyword: args.searchTerm,
    offset: args.offset,
    limit: PAGE_LIMIT,
  });
  const response = await args.fetchImpl(url, {
    headers: getKalibrrSearchHeaders(args.searchTerm),
  });

  if (!response.ok) {
    throw new Error(
      `Kalibrr search request failed with HTTP ${response.status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new Error("Kalibrr search response was not valid JSON.");
  }

  return parseKalibrrSearchPayload(parsed);
}

export async function runKalibrrWithFetcher(
  options: RunKalibrrOptions,
  fetchImpl: FetchLike,
): Promise<KalibrrResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : DEFAULT_SEARCH_TERMS;
  const maxJobsPerTerm = resolveKalibrrMaxJobsPerTerm(options.maxJobsPerTerm);
  const allJobs: CreateJobInput[] = [];
  const termTotal = searchTerms.length;

  try {
    for (let index = 0; index < searchTerms.length; index += 1) {
      const termIndex = index + 1;
      const searchTerm = searchTerms[index] ?? "";
      if (options.shouldCancel?.()) {
        return {
          success: true,
          jobs: dedupeKalibrrJobs(allJobs, options.existingJobUrls),
        };
      }

      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal,
        searchTerm,
      });

      const termJobs: CreateJobInput[] = [];
      let offset = 0;
      let pageNo = 1;
      let totalAvailable = Number.POSITIVE_INFINITY;

      while (
        !options.shouldCancel?.() &&
        termJobs.length < maxJobsPerTerm &&
        offset < totalAvailable
      ) {
        const page = await fetchKalibrrSearchPage({
          fetchImpl,
          searchTerm,
          offset,
        });
        totalAvailable = page.count;

        for (const rawJob of page.jobs) {
          const mapped = mapKalibrrJob(rawJob);
          if (!mapped) continue;
          termJobs.push(mapped);
          if (termJobs.length >= maxJobsPerTerm) break;
        }

        options.onProgress?.({
          type: "page_fetched",
          termIndex,
          termTotal,
          searchTerm,
          pageNo,
          resultsOnPage: page.jobs.length,
          totalCollected: termJobs.length,
        });

        if (page.jobs.length === 0) break;
        offset += PAGE_LIMIT;
        pageNo += 1;
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
      jobs: dedupeKalibrrJobs(allJobs, options.existingJobUrls),
    };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while running Kalibrr extractor.",
    };
  }
}

export async function runKalibrr(
  options: RunKalibrrOptions = {},
): Promise<KalibrrResult> {
  return runKalibrrWithFetcher(options, fetch);
}
