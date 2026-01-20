import sqlite3
import os

DB_PATH = os.environ.get("ISYNC_DB_PATH", "isync.db")

def update_schema():
    if not os.path.exists(DB_PATH):
        print(f"Database {DB_PATH} does not exist. Skipping manual schema update.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # New columns to add
    new_columns = [
        ("source_type", "VARCHAR(20) DEFAULT 'LOCAL'"),
        ("source_server_id", "VARCHAR(100)"),
        ("dest_type", "VARCHAR(20) DEFAULT 'LOCAL'"),
        ("dest_server_id", "VARCHAR(100)")
    ]

    # Get existing columns
    cursor.execute("PRAGMA table_info(sync_pairs)")
    existing_cols = [row[1] for row in cursor.fetchall()]

    for col_name, col_type in new_columns:
        if col_name not in existing_cols:
            print(f"Adding column {col_name} to sync_pairs...")
            try:
                cursor.execute(f"ALTER TABLE sync_pairs ADD COLUMN {col_name} {col_type}")
            except Exception as e:
                print(f"Error adding column {col_name}: {e}")
        else:
            print(f"Column {col_name} already exists in sync_pairs.")

    conn.commit()
    conn.close()
    print("Schema update check complete.")

if __name__ == "__main__":
    update_schema()
