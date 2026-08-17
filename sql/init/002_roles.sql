-- ============================================================
-- sky_planner DB 계정 분리 (REQ-DB-002)
-- READ(BFF 조회) / INGEST(배치 적재) / MIGRATION(DDL) 3단계 분리.
-- 비밀번호는 컨테이너 환경변수(SKY_DB_*)에서 주입한다. 아래 기본값은 로컬 docker 전용.
-- 관리형 PostgreSQL에서는 동일 SQL을 실제 자격증명으로 실행한다.
-- (.sql 형태인 이유: .sh는 마운트 실행 비트/해석기 문제로 초기화가 실패할 수 있다.
--  psql 백틱 치환으로 환경변수를 읽는다.)
-- ============================================================

\set read_pw `echo ${SKY_DB_READ_PASSWORD:-sky_planner_read_dev}`
\set ingest_pw `echo ${SKY_DB_INGEST_PASSWORD:-sky_planner_ingest_dev}`
\set migration_pw `echo ${SKY_DB_MIGRATION_PASSWORD:-sky_planner_migration_dev}`

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'sky_planner_read', :'read_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_planner_read') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'sky_planner_read', :'read_pw') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'sky_planner_ingest', :'ingest_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_planner_ingest') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'sky_planner_ingest', :'ingest_pw') \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'sky_planner_migration', :'migration_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_planner_migration') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'sky_planner_migration', :'migration_pw') \gexec

-- 기본 권한 제거 후 최소 권한만 재부여
REVOKE ALL ON DATABASE sky_planner FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 기존 객체 소유권을 MIGRATION 롤로 이전 (이후 DDL은 migration 계정만 가능)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO sky_planner_migration', r.tablename);
  END LOOP;
END $$;

GRANT CONNECT ON DATABASE sky_planner TO sky_planner_read, sky_planner_ingest, sky_planner_migration;
GRANT USAGE ON SCHEMA public TO sky_planner_read, sky_planner_ingest, sky_planner_migration;

-- READ: BFF 조회 전용 (SELECT 만)
GRANT SELECT ON places, deals_current, offers, fare_snapshots, source_health, batch_state TO sky_planner_read;
ALTER DEFAULT PRIVILEGES FOR ROLE sky_planner_migration IN SCHEMA public
  GRANT SELECT ON TABLES TO sky_planner_read;

-- INGEST: 배치 적재가 쓰는 테이블에 대한 제한된 쓰기 (DDL 불가)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  places, offers, fare_snapshots, deals_current, source_jobs, source_health, batch_state
TO sky_planner_ingest;

-- MIGRATION: DDL 실행 (신규 테이블/인덱스 생성)
GRANT CREATE ON SCHEMA public TO sky_planner_migration;
GRANT CREATE ON DATABASE sky_planner TO sky_planner_migration;
