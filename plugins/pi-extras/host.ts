import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { piExtrasHostContract } from "./contract.js";
import { readPiUsage } from "./usage.js";
import { readSettings, runPiUpdate, writeSettings } from "./pi-settings.js";
import { readTrustChecksForPaths, saveTrustDecision } from "./pi-trust.js";
import { listAvailableModels } from "./pi-models.js";
import { generateText, probeTextReadiness } from "./pi-title-runner.js";

export default experimental_defineHostEntry({
  contract: piExtrasHostContract,
  handlers: {
    readUsage: async () => readPiUsage(),
    readSettings: async () => readSettings(),
    writeSettings: async (next) => writeSettings(next),
    update: async ({ target }) => runPiUpdate(target),
    listModels: async () => listAvailableModels(),
    generateText: async ({ prompt, model }) => generateText({ prompt, model }),
    probeTitleService: async () => probeTextReadiness(),
    readTrustChecks: async ({ paths, force }) => ({
      checks: readTrustChecksForPaths(paths, force === true),
    }),
    saveTrustDecision: async ({ path, confirm: _confirm, expectedCanonicalPath }) =>
      saveTrustDecision(path, process.env, expectedCanonicalPath),
  },
});
