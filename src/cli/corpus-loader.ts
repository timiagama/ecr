/**
 * Corpus Loading
 *
 * File discovery is the host's responsibility, not the linter's. This module
 * is the CLI's implementation of that responsibility: it walks a directory,
 * excludes meta-documents, and produces the inputs the linter consumes.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MetaDocumentFilter } from '../meta-documents.js';
import type { CorpusDocumentInput } from '../ecr.js';

/**
 * The outcome of walking a corpus directory.
 */
export interface LoadedCorpus {
  /** Documents to validate, in path order. */
  readonly documents: readonly CorpusDocumentInput[];
  /** Corpus-relative paths excluded as meta-documents or by ignore pattern. */
  readonly excludedPaths: readonly string[];
}

/**
 * Directory-walking characters that mark a path as hidden on every platform
 * this runs on. Hidden directories are skipped so that `.git`, `.obsidian` and
 * similar never reach the linter.
 */
const HIDDEN_PREFIX: string = '.';

/**
 * Extension identifying a Markdown document.
 */
const MARKDOWN_EXTENSION: string = '.md';

/**
 * Discovers and reads the Markdown documents of a corpus.
 *
 * Paths are reported relative to the corpus root and normalised to forward
 * slashes, so that ignore patterns and diagnostics read the same on every
 * platform.
 */
export class CorpusLoader {
  /** Absolute or relative path to the corpus root directory. */
  private readonly corpusRoot: string;

  /** Decides which discovered documents are excluded from validation. */
  private readonly metaDocumentFilter: MetaDocumentFilter;

  /**
   * Creates a loader for one corpus directory.
   *
   * @param corpusRoot - Path to the directory to walk
   * @param ignorePatterns - Glob patterns excluding project-specific meta-documents
   */
  public constructor(corpusRoot: string, ignorePatterns: readonly string[] = []) {
    this.corpusRoot = corpusRoot;
    this.metaDocumentFilter = new MetaDocumentFilter(ignorePatterns);
  }

  /**
   * Walks the corpus root and reads every Markdown document that is not
   * excluded.
   *
   * @returns The documents to validate and the paths that were excluded
   */
  public load(): LoadedCorpus {
    const discovered: readonly string[] = this.discoverMarkdownPaths(this.corpusRoot);
    const documents: CorpusDocumentInput[] = [];
    const excludedPaths: string[] = [];

    for (const absolutePath of discovered) {
      const relativePath: string = this.toCorpusRelativePath(absolutePath);

      if (this.metaDocumentFilter.shouldExclude(relativePath)) {
        excludedPaths.push(relativePath);
        continue;
      }

      documents.push({
        uri: relativePath,
        markdownText: readFileSync(absolutePath, 'utf8'),
      });
    }

    return { documents, excludedPaths };
  }

  /**
   * Recursively collects Markdown file paths beneath a directory, skipping
   * hidden directories.
   *
   * @param directory - Directory to walk
   * @returns Absolute paths of every Markdown file found, in sorted order
   */
  private discoverMarkdownPaths(directory: string): readonly string[] {
    const collected: string[] = [];

    for (const entryName of readdirSync(directory)) {
      if (entryName.startsWith(HIDDEN_PREFIX)) {
        continue;
      }

      const entryPath: string = join(directory, entryName);

      if (statSync(entryPath).isDirectory()) {
        collected.push(...this.discoverMarkdownPaths(entryPath));
        continue;
      }

      if (entryName.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
        collected.push(entryPath);
      }
    }

    return collected.sort();
  }

  /**
   * Converts an absolute path into a corpus-relative path with forward slashes.
   *
   * @param absolutePath - A path beneath the corpus root
   * @returns The path relative to the corpus root
   */
  private toCorpusRelativePath(absolutePath: string): string {
    const withoutRoot: string = absolutePath.startsWith(this.corpusRoot)
      ? absolutePath.slice(this.corpusRoot.length)
      : absolutePath;

    return withoutRoot
      .split('\\')
      .join('/')
      .replace(/^\/+/, '');
  }
}
