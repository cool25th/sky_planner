#!/usr/bin/env node
// 완료정의[9]/[12]: 시크릿 스캔 가드 — 커밋 메시지·소스 트리에서 고정밀 시크릿 패턴을 찾는다.
// 의존성 0(무료), 오탐 방지를 위해 패턴은 좁게, 공개 dev 플레이스홀더는 예외로 둔다.
// CI(ci.yml lint:secrets)와 로컬에서 모두 실행 가능. 공개 레포 — 여기 걸리면 이미 늦었으니
// 발견 시: 시크릿 폐기(회전)가 우선, 커밋 제거는 그 다음.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 고정밀 패턴만 — 오탐이 CI를 무의미하게 만들지 않도록 일반 토큰 단어는 넣지 않는다.
export const SECRET_PATTERNS = [
  { id: "postgres_credentials", pattern: /postgres(?:ql)?:\/\/[^\s"'@]+:[^\s"'@]+@[^\s"']+/g },
  { id: "github_pat", pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { id: "github_token", pattern: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: "slack_webhook", pattern: /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{10,}/g },
  { id: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "google_api_key", pattern: /AIza[0-9A-Za-z_-]{30,}/g },
];

// 커밋된 공개 dev 플레이스홀더(README·스크립트 기본값·계약 테스트 fixture) — 실 자격증명 아님.
export const ALLOWLIST_SUBSTRINGS = [
  "sky_planner:sky_planner_dev@localhost",
  "contract:nodb@127.0.0.1:1",
  "postgres:postgres@localhost",
];

// postgres 연결 문자열 판정: 예시 호스트(localhost·*.example*)이거나 명백한 가짜 비밀번호면 통과.
// 가짜 비밀번호 목록은 fixture에 실제로 쓰인 최소 집합 — 실 비밀번호와 겹치면 안 된다.
const PLACEHOLDER_HOSTS = /^(localhost|127\.0\.0\.1|.*\.local|db\.example-prod\.com|.*\.example(-prod)?\.(com|net|org|test)|from-file\.example-prod\.com)$/;
const PLACEHOLDER_PASSWORDS = new Set(["secret", "pw", "pass", "password123456"]);

export function isAllowedPostgresPlaceholder(hit) {
  if (ALLOWLIST_SUBSTRINGS.some((allowed) => hit.includes(allowed))) return true;
  try {
    const url = new URL(hit.replace(/^postgres(?:ql)?:/, "https://"));
    if (PLACEHOLDER_HOSTS.test(url.hostname)) return true;
    if (PLACEHOLDER_PASSWORDS.has(url.password)) return true;
  } catch {
    return false;
  }
  return false;
}

export function scanText(text) {
  const findings = [];
  for (const { id, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const hit = match[0];
      if (id === "postgres_credentials" && isAllowedPostgresPlaceholder(hit)) continue;
      if (id !== "postgres_credentials" && ALLOWLIST_SUBSTRINGS.some((allowed) => hit.includes(allowed))) continue;
      findings.push({ id, sample: `${hit.slice(0, 12)}…` });
    }
  }
  return findings;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "__pycache__", "runtime", ".vercel"]);
// 스캐너와 그 계약 테스트는 패턴 자체를 싣는다 — 자기 자신을 검사하지 않는다.
const SKIP_FILES = new Set(["scripts/scan-secrets.mjs", "tests/autonomy-policy-contract.mjs"]);

export function listScanFiles(root, dir = root, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) listScanFiles(root, full, acc);
      continue;
    }
    const relative = full.slice(root.length + 1);
    if (SKIP_FILES.has(relative)) continue;
    if (/\.(ts|tsx|mjs|js|json|md|yml|yaml|sql|py|html|css|txt|example)$/.test(entry) || entry === ".env.example") {
      acc.push(full);
    }
  }
  return acc;
}

export function scanWorkingTree(root = process.cwd()) {
  const findings = [];
  for (const file of listScanFiles(root)) {
    const relative = file.slice(root.length + 1);
    const hits = scanText(readFileSync(file, "utf8"));
    for (const hit of hits) findings.push({ where: relative, ...hit });
  }
  return findings;
}

export function scanRecentCommitMessages(count = 50) {
  let log = "";
  try {
    log = execFileSync("git", ["log", `-${count}`, "--format=%h %s %b"], { encoding: "utf8" });
  } catch {
    return []; // git 없는 환경(예: 아티팩트 체크아웃)은 스킵
  }
  return scanText(log).map((hit) => ({ where: `commit_message(last ${count})`, ...hit }));
}

function main() {
  const findings = [...scanWorkingTree(), ...scanRecentCommitMessages()];
  if (findings.length) {
    console.error(`시크릿 스캔 실패: ${findings.length}건`);
    for (const finding of findings) console.error(`- [${finding.id}] ${finding.where}: ${finding.sample}`);
    console.error("실 시크릿이면 폐기(회전)가 우선입니다 — 커밋 제거보다 먼저.");
    process.exit(1);
  }
  console.log("시크릿 스캔 통과: 시크릿 패턴 0건");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
