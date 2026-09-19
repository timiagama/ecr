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
 */

import { EcrCommandLine } from './cli.js';
import type { CommandOutcome } from './cli.js';

const result: CommandOutcome = new EcrCommandLine().run(process.argv.slice(2));
process.stdout.write(result.output);
process.exitCode = result.exitCode;
