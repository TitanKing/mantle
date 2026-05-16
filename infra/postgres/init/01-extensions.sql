-- Mantle requires these extensions. The Postgres image runs every .sql file
-- in /docker-entrypoint-initdb.d/ exactly once, on first cluster init.
-- Re-running compose against the same volume is a no-op for this script.

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
