import { register } from "node:module";

// 계약 테스트에서 server-only 서버 모듈(lib/data-source.ts 등)을 직접 import하기 위한 훅 등록.
register(new URL("./server-module-hooks.mjs", import.meta.url));
