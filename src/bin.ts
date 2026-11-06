#!/usr/bin/env node
import { run } from "./cli.js";

run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
}).then((code) => {
  process.exitCode = code;
});
