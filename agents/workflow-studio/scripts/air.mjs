#!/usr/bin/env node

import process from "node:process";

import { runWorkflowStudioCli } from "./workflow-studio.mjs";

await runWorkflowStudioCli(["air", ...process.argv.slice(2)]);
