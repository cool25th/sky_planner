import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scanText } from "../scripts/scan-secrets.mjs";

// 완료정의[9]: 자율 개발 안전 클래스는 이 파일에 고정된 5종뿐 — 루프가 조용히 범위를
// 넓히면 이 계약이 실패한다. 확대는 사람 승인 + 이 테스트 갱신을 동반해야만 유효하다.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("autonomy whitelist is pinned to exactly the five approved safe classes", () => {
  const policy = readFileSync(join(repoRoot, "docs/autonomy.md"), "utf8");

  for (const token of ["계약 테스트", "가드", "버그픽스", "신선도 재계산", "합성 체크"]) {
    assert.ok(policy.includes(token), `안전 클래스 "${token}"이 화이트리스트에 없다`);
  }
  // 안전 클래스 열거는 5종으로 닫혀 있다 — 6번째 항목 추가는 승인 없이 불가.
  assert.match(policy, /5\. \*\*합성 체크·운영 관측\*\*/, "안전 클래스 목록이 5종 구조가 아니다");

  for (const unsafe of ["UI 카피", "env 값", "시크릿", "새 의존성", "DDL"]) {
    assert.ok(policy.includes(unsafe), `비안전 클래스 "${unsafe}" 명시가 없다`);
  }
  assert.match(policy, /확대 금지/, "조용한 확대 금지 조항이 없다");
  assert.match(policy, /autonomy-policy-contract/, "확대 시 이 테스트 갱신 조건이 문서에 없다");
  assert.match(policy, /Promote to Production/, "롤백 한 줄이 없다");
});

test("secret scanner catches high-precision patterns and passes known placeholders", () => {
  // GitHub 푸시 보호가 fixture 리터럴을 실제 시크릿으로 오탐한다 — 런타임 조합으로만 패턴을 완성한다.
  const slackBotToken = ["xox", "b-123456789012", "-1234567890123", "-abcdefghijklmnopqrstuvwx"].join("");
  const githubPat = ["github_pat_", "11ABCDEFG", "0123456789_abcdefghijklmnopqrstuvwxyz"].join("");
  const githubToken = ["gh", "p_", "a".repeat(36)].join("");
  const googleKey = ["AI", "zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9"].join("");

  assert.equal(scanText("postgresql://user:S3cretPw@ep-cool.neon.tech/db?sslmode=require").length, 1);
  assert.equal(scanText("postgres://svc:hunter2strong@db.internal.prod/sky").length, 1);
  assert.equal(scanText(`token ${githubToken}`).length, 1);
  assert.equal(scanText(githubPat).length, 1);
  assert.equal(scanText("AKIAIOSFODNN7EXAMPLE").length, 1);
  assert.equal(scanText(["-----BEGIN", " RSA PRIVATE KEY-----"].join("")).length, 1);
  assert.equal(scanText(["https://hooks.slack.com/services/", "T0000000/B0000000/", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("")).length, 1);
  assert.equal(scanText(slackBotToken).length, 1);
  assert.equal(scanText(googleKey).length, 1);

  // 커밋된 공개 dev 플레이스홀더는 통과(오탐으로 CI를 무의미하게 만들지 않는다).
  assert.equal(scanText("postgresql://sky_planner:sky_planner_dev@localhost:5433/sky_planner").length, 0);
  assert.equal(scanText("postgresql://contract:nodb@127.0.0.1:1/none").length, 0);
  assert.equal(scanText("postgresql://sky_planner_read:password123456@db.example.com/sky_planner").length, 0);
  assert.equal(scanText("postgresql://sky_planner:secret@db.example-prod.com/sky_planner").length, 0);
  // 일반 단어는 오탐 금지.
  assert.equal(scanText("OPS_ALERT_WEBHOOK_URL을 설정하고 token 값을 넣는다").length, 0);
});

test("ci runs the secret scan on every push and pull request", () => {
  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /lint:secrets/, "CI에 시크릿 스캔 스텝이 없다");
  const pkg = readFileSync(join(repoRoot, "package.json"), "utf8");
  assert.match(pkg, /"lint:secrets"/, "npm run lint:secrets 스크립트가 없다");
});
