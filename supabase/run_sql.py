#!/usr/bin/env python3
"""
run_sql.py — Production-grade SQL runner for Supabase/Postgres
==============================================================

USAGE:
    python3 supabase/run_sql.py supabase/schema_v2.sql supabase/schema_tiktok.sql
    python3 supabase/run_sql.py supabase/schema_v2.sql --dry-run
    python3 supabase/run_sql.py supabase/schema_v2.sql --force-if-not-exists
    python3 supabase/run_sql.py --self-test

ENV VARS:
    SUPABASE_DB_PASSWORD  (or use --password-env to override the variable name)
    SUPABASE_DB_HOST      (optional override for --host default)

FLAGS:
    --host HOST               DB host   (default: aws-0-eu-central-1.pooler.supabase.com)
    --port PORT               DB port   (default: 6543 — Supabase transaction pooler)
    --db DB                   Database  (default: postgres)
    --user USER               DB user   (default: reads from env or prompts)
    --password-env VAR        Name of env-var that holds the password (default: SUPABASE_DB_PASSWORD)
    --stop-on-error           Abort remaining files on first file failure (default: True)
    --no-stop-on-error        Continue to next file even if one fails
    --dry-run                 Parse and print statements; do NOT execute
    --split-mode semicolon    Statement splitter: "semicolon" (default)
    --force-if-not-exists     Rewrite DDL to be idempotent
    --self-test               Run built-in parser tests and exit

EXAMPLES:
    # Run both schemas
    python3 supabase/run_sql.py supabase/schema_v2.sql supabase/schema_tiktok.sql

    # Dry-run to see what would be executed
    python3 supabase/run_sql.py supabase/schema_v2.sql --dry-run

    # Force idempotent (safe to re-run)
    python3 supabase/run_sql.py supabase/schema_v2.sql --force-if-not-exists

    # Use a different env var name for the password
    python3 supabase/run_sql.py supabase/schema_v2.sql --password-env MY_DB_PASS

    # Self-test the SQL splitter
    python3 supabase/run_sql.py --self-test
"""

from __future__ import annotations

import argparse
import getpass
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, List, Optional

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_sql")


# ──────────────────────────────────────────────────────────────────────────────
# SQL Splitter  (handles $-quoting, single-quoted strings, -- and /* */ comments)
# ──────────────────────────────────────────────────────────────────────────────

def _split_sql(sql: str) -> List[str]:
    """
    Split a SQL script into individual statements, correctly handling:
      • -- single-line comments
      • /* ... */ block comments (can be nested in some dialects; we handle 1-level)
      • 'single-quoted strings'  (with '' escaping)
      • $tag$ dollar-quoted blocks $tag$  (function bodies, DO blocks, etc.)
      • semicolons ONLY outside of all the above

    Returns a list of non-empty, stripped statements (without trailing semicolon).
    """
    statements: List[str] = []
    buf: List[str] = []

    i = 0
    n = len(sql)

    # State
    in_single_quote = False
    in_block_comment = False
    dollar_tag: Optional[str] = None   # e.g. "$body$"

    while i < n:
        ch = sql[i]

        # ── Inside a dollar-quoted block ──────────────────────────────────────
        if dollar_tag is not None:
            end = sql.find(dollar_tag, i)
            if end == -1:
                # Unterminated dollar-quote: append the rest as-is
                buf.append(sql[i:])
                i = n
            else:
                end_idx = end + len(dollar_tag)
                buf.append(sql[i:end_idx])
                i = end_idx
                dollar_tag = None
            continue

        # ── Inside a block comment /* ... */ ─────────────────────────────────
        if in_block_comment:
            end = sql.find("*/", i)
            if end == -1:
                # Unterminated block comment: consume rest
                i = n
            else:
                i = end + 2
                in_block_comment = False
            continue

        # ── Inside a single-quoted string ─────────────────────────────────────
        if in_single_quote:
            if ch == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    # Escaped quote ''
                    buf.append("''")
                    i += 2
                else:
                    buf.append("'")
                    i += 1
                    in_single_quote = False
            else:
                buf.append(ch)
                i += 1
            continue

        # ── Normal mode ───────────────────────────────────────────────────────

        # Single-line comment  -- ...
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            eol = sql.find("\n", i)
            if eol == -1:
                i = n
            else:
                i = eol + 1   # skip the comment line (don't add to buf)
            continue

        # Block comment  /* ... */
        if ch == "/" and i + 1 < n and sql[i + 1] == "*":
            in_block_comment = True
            i += 2
            continue

        # Single-quoted string
        if ch == "'":
            buf.append("'")
            i += 1
            in_single_quote = True
            continue

        # Dollar-quoting: detect $tag$ where tag is [A-Za-z0-9_]*
        if ch == "$":
            m = re.match(r"\$([A-Za-z0-9_]*)\$", sql[i:])
            if m:
                tag = m.group(0)          # e.g. "$body$" or "$$"
                dollar_tag = tag
                buf.append(tag)
                i += len(tag)
                continue

        # Statement terminator
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    # Flush anything remaining (no trailing semicolon)
    leftover = "".join(buf).strip()
    if leftover:
        statements.append(leftover)

    return statements


# ──────────────────────────────────────────────────────────────────────────────
# DDL Rewriter  (--force-if-not-exists)
# ──────────────────────────────────────────────────────────────────────────────

_CREATE_TABLE_RE = re.compile(
    r"^(CREATE\s+TABLE)\s+(?!IF\s+NOT\s+EXISTS\s+)",
    re.IGNORECASE | re.MULTILINE,
)
_CREATE_INDEX_RE = re.compile(
    r"^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS\s+)",
    re.IGNORECASE | re.MULTILINE,
)
_CREATE_VIEW_RE = re.compile(
    r"^(CREATE\s+)VIEW\s+",
    re.IGNORECASE | re.MULTILINE,
)


def _force_idempotent(stmt: str) -> str:
    """
    Rewrite DDL statements to be safe when objects already exist.
      CREATE TABLE foo        → CREATE TABLE IF NOT EXISTS foo
      CREATE INDEX i ON foo   → CREATE INDEX IF NOT EXISTS i ON foo
      CREATE VIEW v AS        → CREATE OR REPLACE VIEW v AS
    """
    stmt = _CREATE_TABLE_RE.sub(r"\1 IF NOT EXISTS ", stmt)
    stmt = _CREATE_INDEX_RE.sub(r"\1 IF NOT EXISTS ", stmt)
    stmt = _CREATE_VIEW_RE.sub(r"\1OR REPLACE VIEW ", stmt)
    return stmt


# ──────────────────────────────────────────────────────────────────────────────
# Runner
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class FileResult:
    path: Path
    ok: bool
    statements_total: int = 0
    statements_executed: int = 0
    elapsed: float = 0.0
    error: str = ""


def _get_password(password_env: str) -> str:
    pw = os.environ.get(password_env, "").strip()
    if pw:
        log.info("Password read from env var %s", password_env)
        return pw
    log.info("Env var %s not set — prompting interactively.", password_env)
    return getpass.getpass("Postgres password: ")


def _connect(args: argparse.Namespace):
    try:
        import psycopg2
    except ImportError:
        log.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    password = _get_password(args.password_env)

    # Determine user
    user = args.user
    if not user:
        user = os.environ.get("SUPABASE_DB_USER", "").strip()
    if not user:
        user = input("DB user (e.g. postgres.abcdefghij): ").strip()

    dsn_safe = (
        f"postgresql://{user}:***@{args.host}:{args.port}/{args.db}"
    )
    log.info("Connecting → %s", dsn_safe)

    conn = psycopg2.connect(
        host=args.host,
        port=args.port,
        dbname=args.db,
        user=user,
        password=password,
        connect_timeout=10,
        sslmode="require",
    )
    conn.autocommit = False
    log.info("Connected ✓")
    return conn


def _run_file(
    conn,
    path: Path,
    args: argparse.Namespace,
) -> FileResult:
    result = FileResult(path=path, ok=False)
    t0 = time.perf_counter()

    log.info("─" * 60)
    log.info("File: %s", path)

    try:
        sql_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        result.error = str(exc)
        result.elapsed = time.perf_counter() - t0
        log.error("Cannot read file: %s", exc)
        return result

    statements = _split_sql(sql_text)
    result.statements_total = len(statements)

    if args.force_if_not_exists:
        statements = [_force_idempotent(s) for s in statements]

    log.info("  Statements found: %d", len(statements))

    if args.dry_run:
        for idx, stmt in enumerate(statements, 1):
            preview = stmt[:120].replace("\n", " ")
            log.info("  [DRY-RUN] stmt %d: %s…", idx, preview)
        result.ok = True
        result.statements_executed = len(statements)
        result.elapsed = time.perf_counter() - t0
        log.info("  [DRY-RUN] File done in %.2fs", result.elapsed)
        return result

    # Real execution — one transaction per file
    cur = conn.cursor()
    try:
        cur.execute("BEGIN")

        for idx, stmt in enumerate(statements, 1):
            try:
                cur.execute(stmt)
                result.statements_executed += 1
                log.debug("  stmt %d OK", idx)
            except Exception as exc:
                err_ctx = stmt[:200].replace("\n", " ")
                result.error = f"stmt {idx}: {exc}\n  context: {err_ctx}"
                log.error("  ✗ stmt %d FAILED: %s", idx, exc)
                log.error("    context: %s…", err_ctx)
                conn.rollback()
                result.elapsed = time.perf_counter() - t0
                return result

        conn.commit()
        result.ok = True
        result.elapsed = time.perf_counter() - t0
        log.info(
            "  ✓ %d/%d statements committed in %.2fs",
            result.statements_executed,
            result.statements_total,
            result.elapsed,
        )
        return result

    except Exception as exc:
        conn.rollback()
        result.error = str(exc)
        result.elapsed = time.perf_counter() - t0
        log.error("  ✗ Transaction error: %s", exc)
        return result
    finally:
        cur.close()


# ──────────────────────────────────────────────────────────────────────────────
# Self-test
# ──────────────────────────────────────────────────────────────────────────────

def _self_test() -> bool:
    """Run built-in correctness tests for the SQL splitter. Returns True if all pass."""
    TESTS = [
        # (description, sql_input, expected_count, must_contain_fragment)
        (
            "Simple statements",
            "SELECT 1; SELECT 2; SELECT 3;",
            3,
            "SELECT 1",
        ),
        (
            "Single-line comments stripped",
            "-- header comment\nSELECT 1; -- inline\nSELECT 2;",
            2,
            "SELECT 1",
        ),
        (
            "Block comment stripped",
            "/* big comment\n   spanning lines */\nSELECT 42;",
            1,
            "SELECT 42",
        ),
        (
            "Single-quoted string with semicolon",
            "INSERT INTO t VALUES ('a;b;c');",
            1,
            "a;b;c",
        ),
        (
            "Dollar-quoted DO block",
            r"""
DO $$
DECLARE v INT := 0;
BEGIN
  FOR i IN 1..10 LOOP
    v := v + i;
  END LOOP;
END;
$$;
SELECT 'after_do';
""",
            2,
            "FOR i IN",
        ),
        (
            "Named dollar-quote $body$",
            r"""
CREATE OR REPLACE FUNCTION hello() RETURNS TEXT LANGUAGE plpgsql AS $body$
BEGIN
  RETURN 'hello; world';
END;
$body$;
""",
            1,
            "hello; world",
        ),
        (
            "Mixed quotes and dollar-quotes",
            r"""
SELECT 'it''s a test'; INSERT INTO t VALUES ('semi;inside'); DO $$ BEGIN NULL; END; $$;
""",
            3,
            "it''s a test",
        ),
        (
            "No trailing semicolon on last statement",
            "SELECT 1; SELECT 2",
            2,
            "SELECT 2",
        ),
        (
            "CREATE TABLE rewrite (force-if-not-exists)",
            "CREATE TABLE events (id SERIAL PRIMARY KEY);",
            1,
            "IF NOT EXISTS",
        ),
        (
            "CREATE OR REPLACE VIEW rewrite",
            "CREATE VIEW v_test AS SELECT 1;",
            1,
            "OR REPLACE",
        ),
    ]

    passed = 0
    failed = 0

    print("\n" + "═" * 60)
    print("  run_sql.py — Self-Test")
    print("═" * 60)

    for desc, sql, expected_count, must_contain in TESTS:
        try:
            # Some tests involve the rewriter
            if "force-if-not-exists" in desc or "OR REPLACE" in desc:
                stmts = [_force_idempotent(s) for s in _split_sql(sql)]
            else:
                stmts = _split_sql(sql)

            count_ok = len(stmts) == expected_count
            contain_ok = any(must_contain in s for s in stmts)

            if count_ok and contain_ok:
                print(f"  ✓  {desc}")
                passed += 1
            else:
                print(f"  ✗  {desc}")
                if not count_ok:
                    print(f"       got {len(stmts)} stmts, expected {expected_count}")
                    for i, s in enumerate(stmts):
                        print(f"       [{i}] {repr(s[:80])}")
                if not contain_ok:
                    print(f"       fragment {repr(must_contain)} not found in any stmt")
                failed += 1

        except Exception as exc:
            print(f"  ✗  {desc}  →  EXCEPTION: {exc}")
            failed += 1

    print("─" * 60)
    print(f"  {passed} passed  /  {failed} failed")
    print("═" * 60 + "\n")

    return failed == 0


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="run_sql.py",
        description="Production-grade SQL runner for Supabase/Postgres",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    p.add_argument("files", nargs="*", type=Path, help=".sql files to execute (in order)")

    # Connection
    p.add_argument(
        "--host",
        default=os.environ.get(
            "SUPABASE_DB_HOST", "aws-0-eu-central-1.pooler.supabase.com"
        ),
        help="DB host (default: Supabase pooler)",
    )
    p.add_argument("--port", type=int, default=6543, help="DB port (default: 6543)")
    p.add_argument("--db", default="postgres", help="Database name")
    p.add_argument("--user", default="", help="DB user (e.g. postgres.abcdefghij)")
    p.add_argument(
        "--password-env",
        default="SUPABASE_DB_PASSWORD",
        metavar="VAR",
        help="Env var holding the DB password (default: SUPABASE_DB_PASSWORD)",
    )

    # Execution
    stop = p.add_mutually_exclusive_group()
    stop.add_argument(
        "--stop-on-error",
        dest="stop_on_error",
        action="store_true",
        default=True,
        help="Abort remaining files on first failure (default: on)",
    )
    stop.add_argument(
        "--no-stop-on-error",
        dest="stop_on_error",
        action="store_false",
        help="Continue to next file even if one fails",
    )

    p.add_argument("--dry-run", action="store_true", help="Parse and print; do not execute")
    p.add_argument(
        "--split-mode",
        choices=["semicolon"],
        default="semicolon",
        help="Statement splitter (default: semicolon)",
    )
    p.add_argument(
        "--force-if-not-exists",
        action="store_true",
        help="Rewrite DDL to be idempotent (CREATE TABLE IF NOT EXISTS, etc.)",
    )
    p.add_argument("--self-test", action="store_true", help="Run built-in parser tests and exit")
    p.add_argument("--verbose", "-v", action="store_true", help="Show each statement as it runs")

    return p


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    # ── Self-test mode ────────────────────────────────────────────────────────
    if args.self_test:
        ok = _self_test()
        sys.exit(0 if ok else 1)

    # ── Validate file arguments ───────────────────────────────────────────────
    if not args.files:
        parser.error("Provide at least one .sql file, or use --self-test")

    missing = [f for f in args.files if not f.exists()]
    if missing:
        for f in missing:
            log.error("File not found: %s", f)
        sys.exit(1)

    # ── Connect (skip for dry-run) ────────────────────────────────────────────
    conn = None
    if not args.dry_run:
        conn = _connect(args)

    # ── Execute files ─────────────────────────────────────────────────────────
    results: List[FileResult] = []
    total_t0 = time.perf_counter()

    for path in args.files:
        res = _run_file(conn, path, args)
        results.append(res)
        if not res.ok and args.stop_on_error:
            log.error("Stopping due to error in %s", path)
            break

    if conn:
        conn.close()
        log.debug("Connection closed")

    # ── Summary ───────────────────────────────────────────────────────────────
    total_elapsed = time.perf_counter() - total_t0
    ok_count = sum(1 for r in results if r.ok)
    fail_count = len(results) - ok_count

    print("\n" + "═" * 60)
    print("  Summary")
    print("─" * 60)
    for r in results:
        icon = "✓" if r.ok else "✗"
        label = "DRY-RUN" if args.dry_run else f"{r.statements_executed}/{r.statements_total} stmts"
        print(f"  {icon}  {r.path.name:40s}  {label}  {r.elapsed:.2f}s")
        if r.error:
            print(f"       ERROR: {r.error[:120]}")
    print("─" * 60)
    print(f"  Files: {ok_count} OK / {fail_count} FAILED  |  Total: {total_elapsed:.2f}s")
    print("═" * 60 + "\n")

    sys.exit(0 if fail_count == 0 else 1)


if __name__ == "__main__":
    main()
