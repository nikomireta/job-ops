import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";

const TECHINASIA_BASE_URL = "https://www.techinasia.com";
const ALGOLIA_HOST = "https://219wx3mpv4-dsn.algolia.net";
const ALGOLIA_AGENT = "Algolia for vanilla JavaScript 3.30.0;JS Helper 2.26.1";
const DEFAULT_ALGOLIA_APP_ID = "219WX3MPV4";
const DEFAULT_ALGOLIA_API_KEY = "b528008a75dc1c4402bfe0d8db8b3f8e";
const DEFAULT_ALGOLIA_INDEX = "job_postings";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const MAX_JOBS_PER_TERM = 1_000;
const DEFAULT_SEARCH_TERMS = ["software engineer"];
const HITS_PER_PAGE = 20;
const DESCRIPTION_MAX_LENGTH = 12_000;

const TECHINASIA_JOB_PATH_RE =
  /^\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const TECHINASIA_COMPANY_PATH_RE = /^\/companies\/([^/?#]+)\/?$/i;
const TECHINASIA_HOSTS = new Set(["www.techinasia.com", "techinasia.com"]);

export type TechInAsiaProgressEvent =
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

export interface RunTechInAsiaOptions {
  searchTerms?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: TechInAsiaProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface TechInAsiaResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

export interface TechInAsiaAlgoliaConfig {
  appId: string;
  apiKey: string;
  indexName: string;
}

export interface TechInAsiaSearchRequest {
  url: string;
  body: {
    requests: Array<{
      indexName: string;
      params: string;
    }>;
  };
}

export interface TechInAsiaSearchPage {
  hits: Record<string, unknown>[];
  page: number;
  nbPages: number;
  nbHits: number;
}

type FetchLike = typeof fetch;

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return undefined;
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
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
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
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(" ", "T")
    : raw;
  const date = new Date(normalized);
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

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

function formatAmount(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function resolveTechInAsiaMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.min(MAX_JOBS_PER_TERM, Math.max(1, Math.floor(parsed)));
}

export function getTechInAsiaAlgoliaConfig(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): TechInAsiaAlgoliaConfig {
  return {
    appId: env.TECHINASIA_ALGOLIA_APP_ID || DEFAULT_ALGOLIA_APP_ID,
    apiKey: env.TECHINASIA_ALGOLIA_API_KEY || DEFAULT_ALGOLIA_API_KEY,
    indexName: env.TECHINASIA_ALGOLIA_INDEX || DEFAULT_ALGOLIA_INDEX,
  };
}

export function makeTechInAsiaSearchRequest(args: {
  searchTerm: string;
  page: number;
  hitsPerPage?: number;
  config?: TechInAsiaAlgoliaConfig;
}): TechInAsiaSearchRequest {
  const config = args.config ?? getTechInAsiaAlgoliaConfig();
  const url = new URL("/1/indexes/*/queries", ALGOLIA_HOST);
  url.searchParams.set("x-algolia-agent", ALGOLIA_AGENT);
  url.searchParams.set("x-algolia-application-id", config.appId);
  url.searchParams.set("x-algolia-api-key", config.apiKey);

  const params = new URLSearchParams({
    query: args.searchTerm,
    hitsPerPage: String(args.hitsPerPage ?? HITS_PER_PAGE),
    page: String(Math.max(0, args.page)),
    facets: JSON.stringify([
      "city.country_name",
      "work_arrangement",
      "job_type.name",
      "position.name",
    ]),
    facetFilters: JSON.stringify(["city.country_name:Indonesia"]),
    tagFilters: "",
  });

  return {
    url: url.toString(),
    body: {
      requests: [
        {
          indexName: config.indexName,
          params: params.toString(),
        },
      ],
    },
  };
}

export function parseTechInAsiaSearchPayload(
  payload: unknown,
): TechInAsiaSearchPage {
  const root = toRecord(payload);
  const firstResult = toRecord(toArray(root?.results)[0]);
  const hits = toArray(firstResult?.hits)
    .map(toRecord)
    .filter((hit): hit is Record<string, unknown> => Boolean(hit));

  return {
    hits,
    page: getNumber(firstResult?.page) ?? 0,
    nbPages: getNumber(firstResult?.nbPages) ?? 0,
    nbHits: getNumber(firstResult?.nbHits) ?? hits.length,
  };
}

export function buildTechInAsiaJobUrl(id: string): string {
  return `${TECHINASIA_BASE_URL}/jobs/${encodeURIComponent(id)}`;
}

export function extractTechInAsiaSourceJobId(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, TECHINASIA_BASE_URL);
    if (!TECHINASIA_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    return url.pathname.match(TECHINASIA_JOB_PATH_RE)?.[1];
  } catch {
    return undefined;
  }
}

export function normalizeTechInAsiaJobUrl(
  value: string | undefined,
): string | undefined {
  const id = extractTechInAsiaSourceJobId(value);
  return id ? buildTechInAsiaJobUrl(id) : undefined;
}

function normalizeTechInAsiaCompanyUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, TECHINASIA_BASE_URL);
    if (!TECHINASIA_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    const slug = url.pathname.match(TECHINASIA_COMPANY_PATH_RE)?.[1];
    return slug
      ? `${TECHINASIA_BASE_URL}/companies/${encodeURIComponent(slug)}`
      : undefined;
  } catch {
    return undefined;
  }
}

export function isIndonesiaTechInAsiaJob(
  job: Record<string, unknown>,
): boolean {
  const city = toRecord(job.city);
  const countryNames = [
    getString(city?.country_name),
    getString(city?.work_country_name),
    ...toArray(toRecord(job.company)?.entity_locations).map((location) =>
      getString(toRecord(location)?.country_name),
    ),
  ];
  return countryNames.some((country) => country?.toLowerCase() === "indonesia");
}

function getLocationParts(job: Record<string, unknown>): {
  city?: string;
  country?: string;
  rawLocation?: string;
} {
  const city = toRecord(job.city);
  const cityName = getString(city?.name);
  const countryName =
    getString(city?.country_name) ?? getString(city?.work_country_name);
  const rawLocation = uniqueStrings([cityName, countryName]).join(", ");
  return {
    city: cityName,
    country: countryName,
    rawLocation: rawLocation || undefined,
  };
}

function inferWorkplaceType(
  job: Record<string, unknown>,
): "remote" | "hybrid" | "onsite" {
  const arrangement = getString(job.work_arrangement)?.toLowerCase();
  if (arrangement?.includes("remote")) return "remote";
  if (arrangement?.includes("hybrid")) return "hybrid";
  if (getBoolean(job.is_remote)) return "remote";
  return "onsite";
}

function buildLocationEvidence(
  job: Record<string, unknown>,
  workplaceType: "remote" | "hybrid" | "onsite",
): JobLocationEvidence {
  const location = getLocationParts(job);
  return {
    rawLocation: location.rawLocation ?? null,
    location:
      location.rawLocation ?? (workplaceType === "remote" ? "Remote" : null),
    countryKey: "indonesia",
    country: "indonesia",
    city: location.city,
    workplaceType,
    isRemote: workplaceType === "remote",
    isHybrid: workplaceType === "hybrid",
    evidenceQuality: location.rawLocation ? "approximate" : "weak",
    source: "techinasia",
    sourceNotes: ["Tech in Asia extractor is scoped to Indonesia."],
  };
}

function formatDescription(job: Record<string, unknown>): string | undefined {
  return truncateText(
    stripHtml(getString(job.description) ?? ""),
    DESCRIPTION_MAX_LENGTH,
  );
}

function formatSalary(job: Record<string, unknown>): {
  salary?: string;
  min?: number;
  max?: number;
  currency?: string;
} {
  if (getBoolean(job.is_salary_visible) === false) return {};

  const min = getNumber(job.salary_min);
  const max = getNumber(job.salary_max);
  const avg = getNumber(job.salary_avg);
  const currency = getString(toRecord(job.currency)?.currency_code);
  const amount =
    min !== undefined && max !== undefined && min !== max
      ? `${formatAmount(min)} - ${formatAmount(max)}`
      : min !== undefined || max !== undefined
        ? formatAmount(min ?? max ?? 0)
        : avg !== undefined
          ? formatAmount(avg)
          : undefined;

  return {
    salary: amount ? [currency, amount].filter(Boolean).join(" ") : undefined,
    min,
    max,
    currency,
  };
}

function formatSkills(job: Record<string, unknown>): string | undefined {
  const values = uniqueStrings(
    toArray(job.job_skills).map((skill) => getString(toRecord(skill)?.name)),
  );
  return values.length > 0 ? values.join(", ") : undefined;
}

function formatIndustries(job: Record<string, unknown>): string | undefined {
  const values = uniqueStrings(
    toArray(job.industries).flatMap((industry) => {
      const record = toRecord(industry);
      return [getString(record?.name), getString(record?.vertical_name)];
    }),
  );
  return values.length > 0 ? values.join(", ") : undefined;
}

function buildEmployerUrl(
  company: Record<string, unknown>,
): string | undefined {
  const slug = getString(company.entity_slug);
  if (slug)
    return `${TECHINASIA_BASE_URL}/companies/${encodeURIComponent(slug)}`;
  return normalizeTechInAsiaCompanyUrl(getString(company.url));
}

function getCompanyUrlDirect(
  company: Record<string, unknown>,
): string | undefined {
  const value =
    getString(company.website) ??
    getString(company.website_url) ??
    getString(company.url);
  if (!isValidHttpUrl(value)) return undefined;
  return normalizeHost(new URL(value).hostname) === "techinasia.com"
    ? undefined
    : value;
}

export function mapTechInAsiaJob(
  job: Record<string, unknown>,
): CreateJobInput | null {
  if (!isIndonesiaTechInAsiaJob(job)) return null;

  const id = getIdString(job.id) ?? getIdString(job.objectID);
  const title = getString(job.title);
  const company = toRecord(job.company) ?? {};
  const employer = getString(company.name) ?? "Unknown Employer";
  if (!id || !title) return null;

  const jobUrl = buildTechInAsiaJobUrl(id);
  const externalLink = getString(job.external_link);
  const workplaceType = inferWorkplaceType(job);
  const location = getLocationParts(job);
  const salary = formatSalary(job);

  return {
    source: "techinasia",
    sourceJobId: id,
    title,
    employer,
    employerUrl: buildEmployerUrl(company),
    jobUrl,
    applicationLink: isValidHttpUrl(externalLink) ? externalLink : jobUrl,
    salary: salary.salary,
    location: location.rawLocation,
    locationEvidence: buildLocationEvidence(job, workplaceType),
    deadline: formatDate(job.expires_at),
    datePosted: formatDate(job.published_at),
    jobDescription: formatDescription(job),
    jobType: getString(toRecord(job.job_type)?.name),
    salaryMinAmount: salary.min,
    salaryMaxAmount: salary.max,
    salaryCurrency: salary.currency,
    isRemote: workplaceType === "remote" ? true : undefined,
    jobFunction: getString(toRecord(job.position)?.name),
    companyIndustry: formatIndustries(job),
    companyLogo: getString(company.avatar),
    companyUrlDirect: getCompanyUrlDirect(company),
    companyNumEmployees: getString(company.employee_count),
    skills: formatSkills(job),
    experienceRange: getString(job.experience),
    companyRating: getNumber(company.employee_rating),
    vacancyCount: getNumber(job.vacancy_count),
    workFromHomeType: workplaceType,
  };
}

export function dedupeTechInAsiaJobs(
  jobs: CreateJobInput[],
  existingJobUrls: readonly string[] = [],
): CreateJobInput[] {
  const existing = new Set(
    existingJobUrls.map((url) => normalizeTechInAsiaJobUrl(url) ?? url),
  );
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    const normalizedUrl = normalizeTechInAsiaJobUrl(job.jobUrl) ?? job.jobUrl;
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

async function fetchTechInAsiaSearchPage(args: {
  fetchImpl: FetchLike;
  searchTerm: string;
  page: number;
  config?: TechInAsiaAlgoliaConfig;
}): Promise<TechInAsiaSearchPage> {
  const request = makeTechInAsiaSearchRequest({
    searchTerm: args.searchTerm,
    page: args.page,
    config: args.config,
  });
  const response = await args.fetchImpl(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    throw new Error(
      `Tech in Asia search request failed with HTTP ${response.status}`,
    );
  }

  return parseTechInAsiaSearchPayload(await response.json());
}

function normalizeSearchTerms(searchTerms: string[] | undefined): string[] {
  const values = uniqueStrings((searchTerms ?? []).map((term) => term.trim()));
  return values.length > 0 ? values : DEFAULT_SEARCH_TERMS;
}

export async function runTechInAsiaWithFetcher(
  options: RunTechInAsiaOptions = {},
  fetchImpl: FetchLike,
): Promise<TechInAsiaResult> {
  const searchTerms = normalizeSearchTerms(options.searchTerms);
  const maxJobsPerTerm = resolveTechInAsiaMaxJobsPerTerm(
    options.maxJobsPerTerm,
  );
  const config = getTechInAsiaAlgoliaConfig();
  const allJobs: CreateJobInput[] = [];
  const termTotal = searchTerms.length;

  try {
    for (let index = 0; index < searchTerms.length; index += 1) {
      const termIndex = index + 1;
      const searchTerm = searchTerms[index] ?? "";
      if (options.shouldCancel?.()) {
        return {
          success: true,
          jobs: dedupeTechInAsiaJobs(allJobs, options.existingJobUrls),
        };
      }

      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal,
        searchTerm,
      });

      const termJobs: CreateJobInput[] = [];
      let pageNo = 0;
      let totalPages = Number.POSITIVE_INFINITY;

      while (
        !options.shouldCancel?.() &&
        termJobs.length < maxJobsPerTerm &&
        pageNo < totalPages
      ) {
        const page = await fetchTechInAsiaSearchPage({
          fetchImpl,
          searchTerm,
          page: pageNo,
          config,
        });
        totalPages = page.nbPages;

        for (const rawJob of page.hits) {
          const mapped = mapTechInAsiaJob(rawJob);
          if (!mapped) continue;
          termJobs.push(mapped);
          if (termJobs.length >= maxJobsPerTerm) break;
        }

        options.onProgress?.({
          type: "page_fetched",
          termIndex,
          termTotal,
          searchTerm,
          pageNo: pageNo + 1,
          resultsOnPage: page.hits.length,
          totalCollected: termJobs.length,
        });

        if (page.hits.length === 0 || page.nbPages <= 0) break;
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
      jobs: dedupeTechInAsiaJobs(allJobs, options.existingJobUrls),
    };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while running Tech in Asia extractor.",
    };
  }
}

export async function runTechInAsia(
  options: RunTechInAsiaOptions = {},
): Promise<TechInAsiaResult> {
  return runTechInAsiaWithFetcher(options, fetch);
}
