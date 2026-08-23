import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// TEST-20260822-001: next.config.ts의 outputFileTracingIncludes 목록이
// readiness 정적 체크(artifactContains)가 읽는 경로를 전부 포함하는지 강제한다.
// 목록과 체크가 어긋나면 배포 환경에서 *_available 체크가 조용히 재실패한다(2026-08-21 사례).

function configGlobs() {
  const config = readFileSync("next.config.ts", "utf8");
  const block = config.slice(
    config.indexOf("const READINESS_STATIC_FILES"),
    config.indexOf("].map", config.indexOf("const READINESS_STATIC_FILES")),
  );
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ""));
}

function artifactPaths() {
  const files = ["lib/readiness-artifacts.ts", "lib/service-readiness-runtime.ts"];
  return files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/artifactContains\(\s*"([^"]+)"/g)].map((m) => m[1]),
  );
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.split("**").map((part) => part.replace(/\*/g, "[^/]*")).join(".*");
  return new RegExp(`^${pattern}$`);
}

test("readiness bundle includes cover every artifactContains path", () => {
  const globs = configGlobs();
  const patterns = globs.map(globToRegExp);
  assert.ok(globs.length >= 20, `config list too small: ${globs.length}`);

  const uncovered = artifactPaths().filter((p) => !patterns.some((re) => re.test(p)));
  assert.deepEqual(uncovered, [], `paths missing from next.config READINESS_STATIC_FILES: ${uncovered.join(", ")}`);
});
