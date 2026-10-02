#!/usr/bin/env node
import { main, reportFatal } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    reportFatal(err);
    process.exitCode = 1;
  },
);
