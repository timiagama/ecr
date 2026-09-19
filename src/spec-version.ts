/**
 * Specification Version
 *
 * The version of the ECR specification this package implements.
 *
 * The specification and the package are versioned independently: a linter bug
 * fix is a package release that leaves the grammar untouched, and a
 * specification clarification may need no package release at all. Tying the
 * two numbers together would force one to move whenever the other did.
 *
 * This constant is the single source of truth for the implemented version. A
 * test asserts that the specification document and the README state the same
 * number, so the three cannot drift apart.
 */

/**
 * The ECR specification version implemented by this package.
 */
export const ECR_SPEC_VERSION: string = '1.0.0';
