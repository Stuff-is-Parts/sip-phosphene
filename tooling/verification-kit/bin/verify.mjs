#!/usr/bin/env node
import { main } from '../src/cli/main.mjs';

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`verify: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(2);
  });
