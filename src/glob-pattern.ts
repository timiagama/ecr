/**
 * Glob Patterns
 *
 * The minimal glob syntax used by `--ignore` and `.ecrignore`: `*` matches any
 * run of characters except `/`, `**` matches any run including `/`, a `**`
 * immediately before a slash matches zero or more whole directories, and `?`
 * matches one character other than `/`. Everything else matches literally, and
 * a pattern must match a whole path.
 *
 * A pattern is matched by walking the path once for each part of the pattern,
 * so the work is bounded by the pattern's length times the path's length. An
 * equivalent regular expression is not: patterns such as `*a*a*a*a*a*a*a*ab`
 * make a backtracking engine explore exponentially many ways to divide the
 * path between the wildcards, which let a single crafted ignore pattern hang
 * the linter. Matching here is a table, so no such pattern exists.
 */

/** One part of a compiled pattern. */
type GlobPart =
  /** Characters that must appear exactly. */
  | { readonly kind: 'literal'; readonly text: string }
  /** `?`: one character other than `/`. */
  | { readonly kind: 'oneCharacter' }
  /** `*`: any run of characters within one path segment. */
  | { readonly kind: 'withinSegment' }
  /** `**` not followed by `/`: any run of characters at all. */
  | { readonly kind: 'acrossSegments' }
  /** `**` before a slash: zero or more whole directories. */
  | { readonly kind: 'wholeDirectories' };

/**
 * A compiled glob pattern that can be matched against a path.
 */
export class GlobPattern {
  /** The pattern's parts, in order. */
  private readonly parts: readonly GlobPart[];

  /**
   * Compiles a pattern.
   *
   * @param pattern - The glob pattern
   */
  public constructor(pattern: string) {
    this.parts = GlobPattern.compile(pattern);
  }

  /**
   * Determines whether a path matches the whole pattern.
   *
   * @param path - The path to match, using forward slashes
   * @returns `true` when the pattern matches all of it
   */
  public matches(path: string): boolean {
    const length: number = path.length;

    // `reached[index]` says whether the parts considered so far can match the
    // rest of the path from `index`. It starts as the answer for no parts at
    // all: only a path already consumed to its end matches nothing more.
    let reached: boolean[] = new Array<boolean>(length + 1).fill(false);
    reached[length] = true;

    // Each part is added in front of the answer for the parts after it, so
    // they are considered last one first.
    for (const part of [...this.parts].reverse()) {
      reached = GlobPattern.matchPart(part, path, reached);
    }

    return reached[0] ?? false;
  }

  /**
   * Works out, for every position in the path, whether one part followed by
   * the parts after it can match the rest of the path from there.
   *
   * @param part - The part being added in front
   * @param path - The path being matched
   * @param following - The same answer for the parts after this one
   * @returns The answer for this part and everything after it
   */
  private static matchPart(part: GlobPart, path: string, following: readonly boolean[]): boolean[] {
    switch (part.kind) {
      case 'literal':
        return GlobPattern.matchLiteral(part.text, path, following);

      case 'oneCharacter':
        return GlobPattern.matchOneCharacter(path, following);

      case 'withinSegment':
        return GlobPattern.matchWildcard(path, following, true);

      case 'acrossSegments':
        return GlobPattern.matchWildcard(path, following, false);

      case 'wholeDirectories':
        return GlobPattern.matchWholeDirectories(path, following);
    }
  }

  /**
   * Matches characters that must appear exactly.
   *
   * @param text - The characters the pattern gives
   * @param path - The path being matched
   * @param following - Where the parts after this one can match from
   * @returns Where this part and everything after it can match from
   */
  private static matchLiteral(
    text: string,
    path: string,
    following: readonly boolean[],
  ): boolean[] {
    const reached: boolean[] = new Array<boolean>(path.length + 1).fill(false);

    for (let index: number = 0; index + text.length <= path.length; index += 1) {
      reached[index] = path.startsWith(text, index) && (following[index + text.length] ?? false);
    }

    return reached;
  }

  /**
   * Matches `?`: exactly one character, which may not be a separator.
   *
   * @param path - The path being matched
   * @param following - Where the parts after this one can match from
   * @returns Where this part and everything after it can match from
   */
  private static matchOneCharacter(path: string, following: readonly boolean[]): boolean[] {
    const reached: boolean[] = new Array<boolean>(path.length + 1).fill(false);

    for (let index: number = 0; index < path.length; index += 1) {
      reached[index] = path[index] !== '/' && (following[index + 1] ?? false);
    }

    return reached;
  }

  /**
   * Matches `*` or `**`: a run of any length.
   *
   * A wildcard either stops where it is and lets the parts after it match, or
   * takes one more character and asks itself the same question. Answering
   * from the end of the path backwards means each position is settled once,
   * whereas a regular expression would try the divisions one after another.
   *
   * @param path - The path being matched
   * @param following - Where the parts after this one can match from
   * @param withinSegment - Whether the run must stay inside one path segment
   * @returns Where this part and everything after it can match from
   */
  private static matchWildcard(
    path: string,
    following: readonly boolean[],
    withinSegment: boolean,
  ): boolean[] {
    const reached: boolean[] = new Array<boolean>(path.length + 1).fill(false);

    for (let index: number = path.length; index >= 0; index -= 1) {
      const canTakeOneMore: boolean =
        index < path.length && (!withinSegment || path[index] !== '/');

      reached[index] =
        (following[index] ?? false) || (canTakeOneMore && (reached[index + 1] ?? false));
    }

    return reached;
  }

  /**
   * Matches a `**` immediately before a slash: zero or more whole directories.
   *
   * @param path - The path being matched
   * @param following - Where the parts after this one can match from
   * @returns Where this part and everything after it can match from
   */
  private static matchWholeDirectories(path: string, following: readonly boolean[]): boolean[] {
    // Whole directories are taken whole, so this part matches either nothing
    // at all, or a run of characters ending at a separator.
    const endsAtSlash: boolean[] = new Array<boolean>(path.length + 1).fill(false);

    for (let index: number = path.length - 1; index >= 0; index -= 1) {
      endsAtSlash[index] =
        (path[index] === '/' && (following[index + 1] ?? false)) ||
        (endsAtSlash[index + 1] ?? false);
    }

    return endsAtSlash.map(
      (endsHere: boolean, index: number): boolean => (following[index] ?? false) || endsHere,
    );
  }

  /**
   * Splits a pattern into its parts, gathering runs of ordinary characters
   * into one literal.
   *
   * @param pattern - The glob pattern
   * @returns The parts, in order
   */
  private static compile(pattern: string): readonly GlobPart[] {
    const parts: GlobPart[] = [];
    let literal: string = '';

    /** Closes off any literal gathered so far. */
    const flushLiteral = (): void => {
      if (literal !== '') {
        parts.push({ kind: 'literal', text: literal });
        literal = '';
      }
    };

    for (let index: number = 0; index < pattern.length; index += 1) {
      const character: string = pattern[index] ?? '';

      if (character === '*') {
        flushLiteral();

        if (pattern[index + 1] === '*' && pattern[index + 2] === '/') {
          parts.push({ kind: 'wholeDirectories' });
          index += 2;
        } else if (pattern[index + 1] === '*') {
          parts.push({ kind: 'acrossSegments' });
          index += 1;
        } else {
          parts.push({ kind: 'withinSegment' });
        }
        continue;
      }

      if (character === '?') {
        flushLiteral();
        parts.push({ kind: 'oneCharacter' });
        continue;
      }

      literal += character;
    }

    flushLiteral();

    return parts;
  }
}
