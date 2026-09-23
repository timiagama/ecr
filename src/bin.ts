#!/usr/bin/env node
/**
 * ECR Executable Entry Point
 *
 * This file runs the CLI unconditionally and does nothing else. It must not
 * guard itself with a "was I invoked directly?" check that compares
 * `process.argv[1]` with this module's path: package managers install the
 * binary as a symlink (`node_modules/.bin/ecr`), Node resolves the module to
 * its real path, and the two never match, so a guarded entry point silently
 * exits 0 without running. Keeping the commands in `cli.ts` and the side
 * effect here removes the need for any such check.
 *
 * It is also where supervision is asked for, because this file knows the one
 * thing a supervised run needs: the script a child process would have to run,
 * which is this file itself, at its real path rather than through whatever
 * symlink invoked it. A host embedding the library instead of the command
 * gets no supervision, and bounds its own work.
 */

import { fileURLToPath } from 'node:url';

import { EcrCommandLine } from './cli.js';
import type { CommandOutcome } from './cli.js';

const result: CommandOutcome = new EcrCommandLine({
  supervision: { entryPoint: fileURLToPath(import.meta.url) },
}).run(process.argv.slice(2));

process[result.stream].write(result.output);
process.exitCode = result.exitCode;
