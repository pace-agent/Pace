import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadPaceConfig,
  loadPaceConfigSync,
  ConfigEnvError,
  ConfigValidationError,
} from "./loadPaceConfig.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-config-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Clean up any env vars set during tests
  delete process.env["PACE_TEST_VAR"];
  delete process.env["PACE_OPTIONAL_VAR"];
});

describe("loadPaceConfig", () => {
  it("loads a valid YAML config file", async () => {
    const yamlContent = `
budget:
  maxTokensPerTask: 30000
  maxTokensPerTurn: 5000
`;
    fs.writeFileSync(path.join(tmpDir, "pace.config.yaml"), yamlContent, "utf-8");

    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.usedDefaults).toBe(false);
    expect(result.configPath).toContain("pace.config.yaml");
    expect(result.config.budget.maxTokensPerTask).toBe(30000);
    expect(result.config.budget.maxTokensPerTurn).toBe(5000);
  });

  it("loads a valid JSON config file", async () => {
    const jsonContent = JSON.stringify({ budget: { maxTokensPerTask: 12000 } });
    fs.writeFileSync(path.join(tmpDir, "pace.config.json"), jsonContent, "utf-8");

    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.usedDefaults).toBe(false);
    expect(result.config.budget.maxTokensPerTask).toBe(12000);
  });

  it("auto-search finds pace.config.yaml before yml and json", async () => {
    fs.writeFileSync(path.join(tmpDir, "pace.config.yaml"), "budget:\n  maxTokensPerTask: 11111", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "pace.config.yml"), "budget:\n  maxTokensPerTask: 22222", "utf-8");

    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.config.budget.maxTokensPerTask).toBe(11111);
  });

  it("returns defaults when no config file is found", async () => {
    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.usedDefaults).toBe(true);
    expect(result.configPath).toBeNull();
    // Schema defaults
    expect(result.config.budget.maxTokensPerTask).toBe(20_000);
    expect(result.config.scoring.mode).toBe("keyword");
  });

  it("substitutes ${VAR} env vars before parsing", async () => {
    process.env["PACE_TEST_VAR"] = "8888";
    fs.writeFileSync(
      path.join(tmpDir, "pace.config.yaml"),
      "budget:\n  maxTokensPerTask: ${PACE_TEST_VAR}",
      "utf-8",
    );

    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.config.budget.maxTokensPerTask).toBe(8888);
  });

  it("uses fallback for ${VAR:-default} when var is undefined", async () => {
    delete process.env["PACE_OPTIONAL_VAR"];
    fs.writeFileSync(
      path.join(tmpDir, "pace.config.yaml"),
      "budget:\n  maxTokensPerTask: ${PACE_OPTIONAL_VAR:-9999}",
      "utf-8",
    );

    const result = await loadPaceConfig({ cwd: tmpDir });
    expect(result.config.budget.maxTokensPerTask).toBe(9999);
  });

  it("throws ConfigEnvError for undefined ${VAR} without fallback", async () => {
    delete process.env["PACE_OPTIONAL_VAR"];
    fs.writeFileSync(
      path.join(tmpDir, "pace.config.yaml"),
      "budget:\n  maxTokensPerTask: ${PACE_OPTIONAL_VAR}",
      "utf-8",
    );

    await expect(loadPaceConfig({ cwd: tmpDir })).rejects.toThrow(ConfigEnvError);
  });

  it("throws ConfigValidationError for invalid config values", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pace.config.yaml"),
      // maxTokensPerTask must be positive, -1 is invalid
      "budget:\n  maxTokensPerTask: -1",
      "utf-8",
    );

    await expect(loadPaceConfig({ cwd: tmpDir })).rejects.toThrow(ConfigValidationError);
  });
});

describe("loadPaceConfigSync", () => {
  it("synchronously loads a YAML config", () => {
    fs.writeFileSync(
      path.join(tmpDir, "pace.config.yaml"),
      "budget:\n  maxTokensPerTask: 15000",
      "utf-8",
    );

    const result = loadPaceConfigSync({ cwd: tmpDir });
    expect(result.config.budget.maxTokensPerTask).toBe(15000);
    expect(result.usedDefaults).toBe(false);
  });
});
