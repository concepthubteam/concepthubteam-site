#!/usr/bin/env python3
"""
Run schema_v2.sql against Supabase via direct pooler connection.

Usage:
  python3 supabase/run_schema.py
  # => prompts for DB password

Or non-interactively:
  DB_PASSWORD=your_password python3 supabase/run_schema.py

DB password found at:
  Supabase Dashboard → Settings → Database → Connection string
  (the password field, NOT the service_role_key)
"""

import os
import sys
import getpass
import pathlib

try:
    import psycopg2
except ImportError:
    print("Installing psycopg2-binary...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

PROJECT_REF = "xlelmyucmxjohrqzauzo"
POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com"
POOLER_PORT = 6543
DB_NAME     = "postgres"
DB_USER     = f"postgres.{PROJECT_REF}"

SCHEMA_FILE = pathlib.Path(__file__).parent / "schema_v2.sql"


def main():
    password = os.getenv("DB_PASSWORD") or getpass.getpass("Supabase DB password: ")
    if not password:
        print("❌  No password provided.")
        sys.exit(1)

    print(f"Connecting to {POOLER_HOST}:{POOLER_PORT} ...")
    try:
        conn = psycopg2.connect(
            host=POOLER_HOST,
            port=POOLER_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=password,
            connect_timeout=10,
            sslmode="require",
        )
        conn.autocommit = True
        cur = conn.cursor()
        print("✅  Connected!\n")

        sql = SCHEMA_FILE.read_text()
        print(f"Running {SCHEMA_FILE.name} ({len(sql)} chars)...")
        cur.execute(sql)

        # Verify
        cur.execute("SELECT COUNT(*) FROM events;")
        ev = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM venues;")
        vn = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM source_events;")
        se = cur.fetchone()[0]

        print(f"\n✅  Schema applied successfully!")
        print(f"   events: {ev}  |  venues: {vn}  |  source_events: {se}")
        conn.close()

    except psycopg2.OperationalError as e:
        print(f"❌  Connection error: {e}")
        print("\nMake sure the password is correct.")
        print("Find it at: Supabase Dashboard → Settings → Database → Connection string")
        sys.exit(1)
    except Exception as e:
        print(f"❌  SQL error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
