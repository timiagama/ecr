/**
 * Black-box tests for diagnostic severity and structural invariant violations.
 *
 * Each scenario feeds a real violation through {@link Ecr.validateCorpus} and
 * asserts the severity of the diagnostic the linter actually emits, so a rule
 * that stops firing, or fires at the wrong severity, fails here.
 *
 * Covers: SCN-047, SCN-048, SCN-049
 */
import { describe, it, expect } from "vitest";

import { Ecr } from "../src/ecr.js";
import type { CorpusResult, Diagnostic } from "../src/types.js";

/**
 * Validates a corpus given as a map of URI to Markdown text.
 *
 * @param documents - Documents keyed by URI
 * @returns The corpus result
 */
function validate(documents: Readonly<Record<string, string>>): CorpusResult {
  return new Ecr().validateCorpus(
    Object.entries(documents).map(([uri, markdownText]) => ({ uri, markdownText })),
  );
}

/**
 * Collects every diagnostic in a corpus result, per-document and corpus-wide.
 *
 * @param result - The corpus result
 * @returns All diagnostics
 */
function allDiagnostics(result: CorpusResult): readonly Diagnostic[] {
  return [
    ...result.documents.flatMap((entry) => entry.result.diagnostics),
    ...result.diagnostics,
  ];
}

/** A conforming target document that other fixtures reference. */
const TARGET_DOCUMENT: string = [
  "# 3.1 - Validation Rules",
  "",
  "## 3.1#1 - Scope",
  "",
  "Text.",
  "",
  "## References",
  "",
].join("\n");

describe("Diagnostic severity and structural invariant violations", () => {
  it.each([
    {
      violation: "missing H1 DocID",
      ruleId: "ECR101",
      text: "No heading at all.\n\n## References\n",
    },
    {
      violation: "invalid section numbering",
      ruleId: "ECR102",
      text: "# 5.1 - Doc\n\n## 5.1.1 - Dotted\n\n## References\n",
    },
    {
      violation: "missing References section",
      ruleId: "ECR103",
      text: "# 5.1 - Doc\n\n## 5.1#1 - Section\n",
    },
    {
      violation: "malformed References entry",
      ruleId: "ECR103",
      text: "# 5.1 - Doc\n\n## References\n\n- 3.1 - Validation Rules (sometimes - bad direction)\n",
    },
  ])("SCN-047: $violation is reported as an error", ({ ruleId, text }) => {
    const result: CorpusResult = validate({ "3.1.md": TARGET_DOCUMENT, "5.1.md": text });
    // Only the document under test: the conforming target's empty References
    // section legitimately yields an info-level ECR103 of its own.
    const matching: readonly Diagnostic[] = allDiagnostics(result).filter(
      (diagnostic) => diagnostic.ruleId === ruleId && diagnostic.uri === "5.1.md",
    );

    expect(matching.length, `expected a ${ruleId} diagnostic`).toBeGreaterThan(0);
    for (const diagnostic of matching) {
      expect(diagnostic.severity, "SCN-047").toBe("error");
    }
  });

  it.each([
    {
      violation: "duplicate DocID",
      ruleId: "corpus/duplicate-doc-id",
      documents: { "a.md": TARGET_DOCUMENT, "b.md": TARGET_DOCUMENT },
    },
    {
      violation: "duplicate SectionID",
      ruleId: "corpus/duplicate-section-id",
      documents: {
        "3.1.md": TARGET_DOCUMENT,
        "4.1.md": "# 4.1 - Other\n\n## 3.1#1 - Borrowed\n\n## References\n",
      },
    },
    {
      violation: "unresolved References target",
      ruleId: "corpus/unresolved-reference-target",
      documents: {
        "5.1.md": "# 5.1 - Doc\n\n## References\n\n- 9.9 - Missing (dependency - absent)\n",
      },
    },
    {
      violation: "unresolved inline target",
      ruleId: "corpus/unresolved-inline-target",
      documents: {
        "3.1.md": TARGET_DOCUMENT,
        "5.1.md":
          "# 5.1 - Doc\n\n## 5.1#1 - Section\n\nSee 3.1#9.\n\n" +
          "## References\n\n- 3.1 - Validation Rules (dependency - uses it)\n",
      },
    },
  ])("SCN-048: $violation is reported as an error", ({ ruleId, documents }) => {
    const matching: readonly Diagnostic[] = validate(documents).diagnostics.filter(
      (diagnostic) => diagnostic.ruleId === ruleId,
    );

    expect(matching.length, `expected a ${ruleId} diagnostic`).toBeGreaterThan(0);
    for (const diagnostic of matching) {
      expect(diagnostic.severity, "SCN-048").toBe("error");
    }
  });

  it("SCN-049: a References title that differs from the target's H1 is a warning carrying the canonical title", () => {
    const result: CorpusResult = validate({
      "3.1.md": TARGET_DOCUMENT,
      "5.1.md": "# 5.1 - Doc\n\n## References\n\n- 3.1 - Old Title (dependency - uses it)\n",
    });
    const mismatches: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic) => diagnostic.ruleId === "corpus/reference-title-mismatch",
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.severity, "SCN-049").toBe("warning");
    expect(mismatches[0]!.uri).toBe("5.1.md");
    expect(mismatches[0]!.data, "SCN-049").toEqual({
      targetDocId: "3.1",
      referencedTitle: "Old Title",
      canonicalTitle: "Validation Rules",
    });
    expect(allDiagnostics(result).some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("SCN-049: a matching title, even with a different dash in the H1, produces no warning", () => {
    const result: CorpusResult = validate({
      "3.1.md": TARGET_DOCUMENT.replace("# 3.1 - ", "# 3.1 – "),
      "5.1.md": "# 5.1 - Doc\n\n## References\n\n- 3.1 - Validation Rules (dependency - uses it)\n",
    });

    expect(result.diagnostics).toEqual([]);
  });
});

describe("Undeclared inline targets: a warning in a document, an error only when the target exists", () => {
  const PROSE: string =
    "# 5.1 - Doc\n\n## 5.1#1 - Limits\n\nAt most 100 requests per 60 seconds; see 3 examples below.\n\n## References\n";
  const UNDECLARED_REFERENCE: string =
    "# 5.1 - Doc\n\n## 5.1#1 - Section\n\nApplied per 3.1#1.\n\n## References\n";

  it("a single document cannot tell prose from a reference, so it warns and still passes", () => {
    const result = new Ecr().lintDocument("5.1.md", UNDECLARED_REFERENCE);
    const ecr104: readonly Diagnostic[] = result.diagnostics.filter((diagnostic) => diagnostic.ruleId === "ECR104");

    expect(ecr104).toHaveLength(1);
    expect(ecr104[0]!.severity).toBe("warning");
    expect(ecr104[0]!.data).toMatchObject({ targetId: "3.1#1", targetDocId: "3.1" });
    expect(result.ok).toBe(true);
  });

  it("numbers in ordinary prose that name no document stay warnings, so the corpus passes", () => {
    const result: CorpusResult = validate({ "5.1.md": PROSE });
    const diagnostics: readonly Diagnostic[] = allDiagnostics(result);

    expect(
      diagnostics
        .filter((diagnostic) => diagnostic.ruleId === "ECR104")
        .map((diagnostic) => [diagnostic.data?.["targetId"], diagnostic.severity]),
    ).toEqual([
      ["60", "warning"],
      ["3", "warning"],
    ]);
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("an undeclared reference to a document that exists is a corpus error, located at the reference", () => {
    const result: CorpusResult = validate({ "3.1.md": TARGET_DOCUMENT, "5.1.md": UNDECLARED_REFERENCE });
    const errors: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic) => diagnostic.ruleId === "corpus/undeclared-inline-target",
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]!.severity).toBe("error");
    expect(errors[0]!.uri).toBe("5.1.md");
    expect(errors[0]!.range?.start.line).toBe(4);
    expect(errors[0]!.data).toMatchObject({ targetId: "3.1#1", parentDocId: "3.1" });
  });
});
