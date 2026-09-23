export type {
  DocID,
  SectionID,
  DiagnosticSeverity,
  Position,
  PositionRange,
  Diagnostic,
  ReferenceDirection,
  InlineReferenceKind,
  SectionNode,
  ReferenceEdge,
  InlineReferenceEdge,
  ExtractedDocument,
  LintInput,
  LintResult,
  CorpusDocumentEntry,
  CorpusIndex,
  CorpusResult,
} from "./types.js";

export { IdentifierGrammar } from "./identifier-grammar.js";
export type {
  DocIdParseResult,
  SectionIdParseResult,
  HeadingParseResult,
  SectionHeadingParseResult,
  SeparatorValidationResult,
} from "./identifier-grammar.js";

export { DocumentIdentityRule, DOCUMENT_IDENTITY_RULE_ID } from "./document-identity-rule.js";
export type {
  HeadingNodeData,
  DocumentIdentity,
  DocumentIdentityRuleResult,
  DocumentIdentityRuleOptions,
} from "./document-identity-rule.js";

export { SectionHierarchyRule, SECTION_HIERARCHY_RULE_ID } from "./section-hierarchy-rule.js";
export type {
  SectionHierarchyRuleOptions,
  SectionHierarchyRuleResult,
} from "./section-hierarchy-rule.js";

export { ReferencesSectionRule, REFERENCES_SECTION_RULE_ID } from "./references-section-rule.js";
export type {
  ListItemNodeData,
  ListItemSegment,
  ParsedReferenceEntry,
  ReferencesSectionRuleResult,
  ReferencesSectionRuleOptions,
} from "./references-section-rule.js";

export { InlineReferenceRule, INLINE_REFERENCE_RULE_ID } from "./inline-reference-rule.js";
export type {
  TextNodeData,
  InlineSegment,
  InlineSegmentKind,
  DetectedInlineReference,
  InlineReferenceRuleResult,
  InlineReferenceRuleOptions,
} from "./inline-reference-rule.js";

export {
  PerDocumentVisitor,
  UNPARSABLE_DOCUMENT_RULE_ID,
  UNPARSABLE_DOCUMENT_CAUSE,
} from "./per-document-visitor.js";
export type {
  PerDocumentVisitorOptions,
} from "./per-document-visitor.js";

export { CorpusValidator } from "./corpus-validator.js";

export { Ecr } from "./ecr.js";
export type { CorpusDocumentInput } from "./ecr.js";

export { MetaDocumentFilter, DEFAULT_META_DOCUMENT_NAMES } from "./meta-documents.js";
export { ECR_SPEC_VERSION } from "./spec-version.js";
