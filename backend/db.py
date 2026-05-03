import sqlite3
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "instance" / "oxocraft.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                achievement_code TEXT NOT NULL UNIQUE,
                achievement_name TEXT NOT NULL,
                description TEXT,
                is_completed INTEGER NOT NULL DEFAULT 0,
                completed_at DATETIME,
                is_notified INTEGER NOT NULL DEFAULT 0,
                notified_at DATETIME
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS cat_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cat_code TEXT NOT NULL UNIQUE,
                cat_name TEXT NOT NULL,
                image_path TEXT NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS cat_collection (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cat_code TEXT NOT NULL UNIQUE,
                obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS player_deaths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                death_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                death_type TEXT,
                death_text TEXT,
                killer TEXT,
                item TEXT,
                x INTEGER,
                y INTEGER,
                z INTEGER,
                dimension TEXT,
                raw_log TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS backup_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

                status TEXT NOT NULL,
                backup_type TEXT DEFAULT 'local',

                map_name TEXT,
                source_path TEXT,
                backup_path TEXT,

                total_files INTEGER DEFAULT 0,
                total_bytes INTEGER DEFAULT 0,

                message TEXT,

                cloud_provider TEXT,
                cloud_account TEXT,
                cloud_file_id TEXT,
                cloud_link TEXT,
                cloud_file_status TEXT DEFAULT 'active'
            )
        """)

        conn.commit()


def insert_player_death(
    player_name: str,
    death_type: str | None,
    death_text: str | None,
    killer: str | None,
    item: str | None,
    x: int | None,
    y: int | None,
    z: int | None,
    dimension: str | None,
    raw_log: str | None,
) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO player_deaths (
                player_name,
                death_type,
                death_text,
                killer,
                item,
                x,
                y,
                z,
                dimension,
                raw_log
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            player_name,
            death_type,
            death_text,
            killer,
            item,
            x,
            y,
            z,
            dimension,
            raw_log,
        ))

        # 只保留最新 10 筆
        conn.execute("""
            DELETE FROM player_deaths
            WHERE id NOT IN (
                SELECT id
                FROM player_deaths
                ORDER BY death_time DESC, id DESC
                LIMIT 10
            )
        """)

        conn.commit()


def get_recent_player_deaths(limit: int = 10) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM player_deaths
            ORDER BY death_time DESC, id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]


def insert_backup_record(
    status: str,
    map_name: str | None,
    source_path: str | None,
    backup_path: str | None,
    total_files: int | None,
    total_bytes: int | None,
    message: str | None,
    backup_type: str = "local",
    cloud_provider: str | None = None,
    cloud_account: str | None = None,
    cloud_file_id: str | None = None,
    cloud_link: str | None = None,
    cloud_file_status: str = "active",
) -> dict:
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO backup_records (
                created_at,
                status,
                map_name,
                source_path,
                backup_path,
                total_files,
                total_bytes,
                message,
                backup_type,
                cloud_provider,
                cloud_account,
                cloud_file_id,
                cloud_link,
                cloud_file_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            created_at,
            status,
            map_name,
            source_path,
            backup_path,
            total_files or 0,
            total_bytes or 0,
            message,
            backup_type,
            cloud_provider,
            cloud_account,
            cloud_file_id,
            cloud_link,
            cloud_file_status,
        ))

        record_id = cursor.lastrowid
        conn.commit()

        row = conn.execute("""
            SELECT *
            FROM backup_records
            WHERE id = ?
        """, (record_id,)).fetchone()

    return dict(row)


def get_backup_records(limit: int = 20) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM backup_records
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]

def get_latest_success_backup() -> dict | None:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM backup_records
            WHERE status = 'success'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        """).fetchone()

    return dict(row) if row else None

def insert_cloud_backup_record(
    status: str,
    map_name: str | None,
    local_backup_path: str | None,
    total_bytes: int | None,
    message: str | None,
    cloud_provider: str,
    cloud_account: str | None,
    cloud_file_id: str | None,
    cloud_link: str | None,
) -> dict:
    return insert_backup_record(
        status=status,
        map_name=map_name,
        source_path=local_backup_path,
        backup_path=local_backup_path,
        total_files=0,
        total_bytes=total_bytes,
        message=message,
        backup_type="cloud",
        cloud_provider=cloud_provider,
        cloud_account=cloud_account,
        cloud_file_id=cloud_file_id,
        cloud_link=cloud_link,
        cloud_file_status="active",
    )


def mark_cloud_backup_deleted(cloud_file_id: str) -> None:
    if not cloud_file_id:
        return

    with get_connection() as conn:
        conn.execute("""
            UPDATE backup_records
            SET cloud_file_status = 'deleted'
            WHERE cloud_file_id = ?
        """, (cloud_file_id,))

        conn.commit()


def update_backup_record_status(
    record_id: int,
    status: str,
    message: str | None = None,
    cloud_file_id: str | None = None,
    cloud_link: str | None = None,
    cloud_file_status: str | None = None,
) -> dict | None:
    fields = ["status = ?"]
    values = [status]

    if message is not None:
        fields.append("message = ?")
        values.append(message)

    if cloud_file_id is not None:
        fields.append("cloud_file_id = ?")
        values.append(cloud_file_id)

    if cloud_link is not None:
        fields.append("cloud_link = ?")
        values.append(cloud_link)

    if cloud_file_status is not None:
        fields.append("cloud_file_status = ?")
        values.append(cloud_file_status)

    values.append(record_id)

    with get_connection() as conn:
        conn.execute(f"""
            UPDATE backup_records
            SET {", ".join(fields)}
            WHERE id = ?
        """, values)

        conn.commit()

        row = conn.execute("""
            SELECT *
            FROM backup_records
            WHERE id = ?
        """, (record_id,)).fetchone()

    return dict(row) if row else None


def mark_interrupted_cloud_uploads_failed() -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE backup_records
            SET
                status = 'failed',
                message = '程式中斷，雲端上傳未完成',
                cloud_file_status = 'deleted'
            WHERE backup_type = 'cloud'
              AND status = 'running'
        """)

        conn.commit()
