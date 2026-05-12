import { describe, expect, it } from "vitest";
import { applyTailoredSummary, extractProjectsFromResume } from "./tailoring";

describe("rxresume tailoring", () => {
  it("wraps tailored summary in html when the existing summary is html", () => {
    const resumeData = {
      summary: {
        content: "<p>Old summary.</p>",
      },
    };

    applyTailoredSummary(
      resumeData,
      "New summary with\nextra spacing for the template.",
    );

    expect(resumeData.summary.content).toBe(
      "<p>New summary with extra spacing for the template.</p>",
    );
  });

  it("escapes tailored summary text before writing it into html", () => {
    const resumeData = {
      summary: {
        content: "<p>Old summary.</p>",
      },
    };

    applyTailoredSummary(
      resumeData,
      'Builds APIs & tools for <critical> "production" systems.',
    );

    expect(resumeData.summary.content).toBe(
      "<p>Builds APIs &amp; tools for &lt;critical&gt; &quot;production&quot; systems.</p>",
    );
  });

  it("keeps tailored summary plain when the existing summary is plain text", () => {
    const resumeData = {
      summary: {
        content: "Old summary.",
      },
    };

    applyTailoredSummary(resumeData, "New summary.");

    expect(resumeData.summary.content).toBe("New summary.");
  });

  it("strips html from project catalog descriptions", () => {
    const { catalog, selectionItems } = extractProjectsFromResume({
      sections: {
        projects: {
          items: [
            {
              id: "p1",
              name: "Analytics",
              description:
                "<ul><li><p><strong>Built analytics</strong> using FastAPI.</p></li></ul>",
              hidden: false,
              period: "2024",
            },
          ],
        },
      },
    });

    expect(catalog[0].description).toBe("Built analytics using FastAPI.");
    expect(selectionItems[0].summaryText).toBe(
      "Built analytics using FastAPI.",
    );
  });
});
