import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extractor deployment config", () => {
  it("ships the Naukri extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/naukri/package*.json ./extractors/naukri/",
    );
    expect(dockerfile).toContain("COPY extractors/naukri ./extractors/naukri");
  });

  it("ships the Jobindex extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/jobindex/package*.json ./extractors/jobindex/",
    );
    expect(dockerfile).toContain(
      "COPY extractors/jobindex ./extractors/jobindex",
    );
  });

  it("ships the Glints extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/glints/package*.json ./extractors/glints/",
    );
    expect(dockerfile).toContain("COPY extractors/glints ./extractors/glints");
  });

  it("ships the Kalibrr extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/kalibrr/package*.json ./extractors/kalibrr/",
    );
    expect(dockerfile).toContain(
      "COPY extractors/kalibrr ./extractors/kalibrr",
    );
  });

  it("ships the Dealls extractor in Docker runtime images", async () => {
    const dockerfile = await readFile(resolve(process.cwd(), "../Dockerfile"), {
      encoding: "utf8",
    });

    expect(dockerfile).toContain(
      "COPY extractors/dealls/package*.json ./extractors/dealls/",
    );
    expect(dockerfile).toContain("COPY extractors/dealls ./extractors/dealls");
  });

  it("syncs the Naukri extractor in compose development mode", async () => {
    const composeFile = await readFile(
      resolve(process.cwd(), "../docker-compose.yml"),
      { encoding: "utf8" },
    );

    expect(composeFile).toContain("path: ./extractors/naukri");
    expect(composeFile).toContain("target: /app/extractors/naukri");
  });

  it("syncs the Jobindex extractor in compose development mode", async () => {
    const composeFile = await readFile(
      resolve(process.cwd(), "../docker-compose.yml"),
      { encoding: "utf8" },
    );

    expect(composeFile).toContain("path: ./extractors/jobindex/src");
    expect(composeFile).toContain("target: /app/extractors/jobindex/src");
  });

  it("syncs the Glints extractor in compose development mode", async () => {
    const composeFile = await readFile(
      resolve(process.cwd(), "../docker-compose.yml"),
      { encoding: "utf8" },
    );

    expect(composeFile).toContain("path: ./extractors/glints");
    expect(composeFile).toContain("target: /app/extractors/glints");
  });

  it("syncs the Kalibrr extractor in compose development mode", async () => {
    const composeFile = await readFile(
      resolve(process.cwd(), "../docker-compose.yml"),
      { encoding: "utf8" },
    );

    expect(composeFile).toContain("path: ./extractors/kalibrr");
    expect(composeFile).toContain("target: /app/extractors/kalibrr");
  });

  it("syncs the Dealls extractor in compose development mode", async () => {
    const composeFile = await readFile(
      resolve(process.cwd(), "../docker-compose.yml"),
      { encoding: "utf8" },
    );

    expect(composeFile).toContain("path: ./extractors/dealls");
    expect(composeFile).toContain("target: /app/extractors/dealls");
  });
});
