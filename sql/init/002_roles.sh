#!/bin/bash
# ============================================================
# sky_planner DB 계정 분리 (REQ-DB-002)
# READ(BFF 조회) / INGEST(배치 적재) / MIGRATION(DDL) 3단계 분리.
# 비밀번호는 환경변수로 주입한다. 아래 기본값은 로컬 docker 전용.
# 관리형 PostgreSQL에서는 동일 SQL을 실제 자격증명으로 실행한다.
# ============================================================
set -e

read_password="${SKY_DB_READ_PASSWORD:-sky_planner_read_dev}"
ingest_password="${SKY_DB_INGEST_PASSWORD:-sky_planner_ingest_dev}"
migration_password="${SKY_DB_MIGRATION_PASSWORD:-sky_planner_migration_dev}"

role_exists() {
  [ "$(docker_process_sql --dbname "$POSTGRES_DB" -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$1'")" = "1" ]
}

create_role() {
  local name="$1" password="$2"
  if role_exists "$name"; then
    docker_process_sql --dbname "$POSTGRES_DB" <<EOSQL
ALTER ROLE $name LOGIN PASSWORD '$password';
EOSQL
  else
    docker_process_sql --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE $name LOGIN PASSWORD '$password';
EOSQL
  fi
}

create_role sky_planner_read "$read_password"
create_role sky_planner_ingest "$ingest_password"
create_role sky_planner_migration "$migration_password"

docker_process_sql --dbname "$POSTGRES_DB" <<'EOSQL'
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

-- MIGRATION: DDL 실행 (신규 테이블/인덱스 생성, trusted extension)
GRANT CREATE ON SCHEMA public TO sky_planner_migration;
GRANT CREATE ON DATABASE sky_planner TO sky_planner_migration;
EOSQL
