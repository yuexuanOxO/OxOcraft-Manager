import sqlite3
from datetime import datetime
from backend.paths import DB_PATH


DEFAULT_HISTORY_LIMIT = 300 #保留多少筆資料
DEFAULT_HISTORY_TRIM_TO = 200 #清理後保留多少筆資料


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
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

        conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL DEFAULT 'info',
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                source TEXT,
                is_read INTEGER NOT NULL DEFAULT 0,
                is_important INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS players (
                player_uuid TEXT PRIMARY KEY,
                player_name TEXT NOT NULL,

                account_type TEXT NOT NULL DEFAULT 'unknown',
                is_online INTEGER NOT NULL DEFAULT 0,

                first_seen_at DATETIME,
                last_seen_at DATETIME,

                usercache_expires_on TEXT,
                     
                show_in_player_candidates INTEGER NOT NULL DEFAULT 1,

                op INTEGER NOT NULL DEFAULT 0,
                op_since DATETIME,

                whitelisted INTEGER NOT NULL DEFAULT 0,
                whitelisted_since DATETIME,
                     
                banned INTEGER NOT NULL DEFAULT 0,
                banned_since DATETIME,
                ban_reason TEXT DEFAULT '',
                ban_expires_at DATETIME,

                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS ip_records (
                ip TEXT PRIMARY KEY,

                last_player_uuid TEXT,
                last_player_name TEXT,
                last_account_type TEXT,
                last_port TEXT,

                first_seen DATETIME,
                last_seen DATETIME,
                seen_count INTEGER NOT NULL DEFAULT 0,

                banned INTEGER NOT NULL DEFAULT 0,
                banned_since DATETIME,
                ban_reason TEXT DEFAULT '',
                ban_expires_at DATETIME,

                operator_uuid TEXT,
                operator_name TEXT DEFAULT 'OxOcraft',

                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS ip_player_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                ip TEXT NOT NULL,

                player_uuid TEXT NOT NULL,
                player_name TEXT NOT NULL,
                account_type TEXT,

                first_seen DATETIME NOT NULL,
                last_seen DATETIME NOT NULL,
                seen_count INTEGER NOT NULL DEFAULT 1,

                UNIQUE(ip, player_uuid)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS ip_ban_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                action TEXT NOT NULL,

                ip TEXT NOT NULL,
                reason TEXT DEFAULT '',

                operator_uuid TEXT,
                operator_name TEXT DEFAULT 'OxOcraft',
                source TEXT DEFAULT 'unknown',

                detail TEXT DEFAULT '',
                     
                expires_at DATETIME,

                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS player_access_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                category TEXT NOT NULL,
                action TEXT NOT NULL,

                target_uuid TEXT,
                target_name TEXT NOT NULL,
                account_type TEXT,

                operator_uuid TEXT,
                operator_name TEXT,

                source TEXT DEFAULT 'unknown',

                detail TEXT DEFAULT '',
                     
                expires_at DATETIME,

                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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


def get_recent_player_deaths_grouped(limit_per_player: int = 5) -> list[dict]:
    with get_connection() as conn:

        players = conn.execute("""
            SELECT DISTINCT player_name
            FROM player_deaths
            ORDER BY death_time DESC, id DESC
        """).fetchall()

        result = []

        for player_row in players:
            player_name = player_row["player_name"]

            death_rows = conn.execute("""
                SELECT *
                FROM player_deaths
                WHERE player_name = ?
                ORDER BY death_time DESC, id DESC
                LIMIT ?
            """, (
                player_name,
                limit_per_player
            )).fetchall()

            result.append({
                "player_name": player_name,
                "deaths": [dict(row) for row in death_rows]
            })

    return result


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


def mark_interrupted_local_backups_failed() -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE backup_records
            SET
                status = 'failed',
                message = '程式中斷，本機備份未完成'
            WHERE backup_type = 'local'
              AND status = 'running'
        """)

        conn.commit()


def upsert_player_from_usercache(
    player_uuid: str,
    player_name: str,
    account_type: str,
    usercache_expires_on: str | None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                usercache_expires_on,
                show_in_player_candidates,
                updated_at
            )
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                usercache_expires_on = excluded.usercache_expires_on,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            usercache_expires_on,
            now,
        ))

        conn.commit()


def upsert_ip_player_login(
    ip: str,
    player_uuid: str,
    player_name: str,
    account_type: str,
    port: str | None = None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    ip = str(ip or "").strip()
    player_uuid = str(player_uuid or "").strip()
    player_name = str(player_name or "").strip()
    account_type = str(account_type or "unknown").strip()
    port = str(port or "").strip() if port else None

    if not ip or not player_uuid or not player_name:
        return

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO ip_records (
                ip,
                last_player_uuid,
                last_player_name,
                last_account_type,
                last_port,
                first_seen,
                last_seen,
                seen_count,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(ip) DO UPDATE SET
                last_player_uuid = excluded.last_player_uuid,
                last_player_name = excluded.last_player_name,
                last_account_type = excluded.last_account_type,
                last_port = excluded.last_port,
                first_seen = COALESCE(ip_records.first_seen, excluded.first_seen),
                last_seen = excluded.last_seen,
                seen_count = ip_records.seen_count + 1,
                updated_at = excluded.updated_at
        """, (
            ip,
            player_uuid,
            player_name,
            account_type,
            port,
            now,
            now,
            now,
        ))

        conn.execute("""
            INSERT INTO ip_player_history (
                ip,
                player_uuid,
                player_name,
                account_type,
                first_seen,
                last_seen,
                seen_count
            )
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(ip, player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                last_seen = excluded.last_seen,
                seen_count = ip_player_history.seen_count + 1
        """, (
            ip,
            player_uuid,
            player_name,
            account_type,
            now,
            now,
        ))

        conn.commit()


def get_all_players() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM players
            ORDER BY player_name COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def get_player_by_name(player_name: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM players
            WHERE lower(player_name) = lower(?)
            ORDER BY updated_at DESC
            LIMIT 1
        """, (player_name,)).fetchone()

    return dict(row) if row else None


def upsert_player_identity(
    player_uuid: str,
    player_name: str,
    account_type: str,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            now,
        ))

        conn.commit()


def delete_player_by_uuid(player_uuid: str) -> None:
    conn = get_connection()

    conn.execute(
        """
        DELETE FROM players
        WHERE lower(player_uuid) = lower(?)
        """,
        (player_uuid,)
    )

    conn.commit()
    conn.close()


def hide_player_candidate(player_uuid: str) -> None:
    player_uuid = str(player_uuid or "").strip()

    if not player_uuid:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            UPDATE players
            SET show_in_player_candidates = 0,
                updated_at = ?
            WHERE lower(player_uuid) = lower(?)
        """, (
            now,
            player_uuid,
        ))

        conn.commit()


def upsert_player_login(
    player_uuid: str,
    player_name: str,
    account_type: str,
    usercache_expires_on: str | None = None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                is_online,
                first_seen_at,
                last_seen_at,
                usercache_expires_on,
                show_in_player_candidates,
                updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?, ?, 1, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                is_online = 1,
                first_seen_at = COALESCE(players.first_seen_at, excluded.first_seen_at),
                last_seen_at = excluded.last_seen_at,
                usercache_expires_on = COALESCE(excluded.usercache_expires_on, players.usercache_expires_on),
                show_in_player_candidates = 1,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            now,
            now,
            usercache_expires_on,
            now,
        ))

        conn.commit()


def mark_player_offline_by_name(player_name: str) -> None:
    player_name = str(player_name or "").strip()

    if not player_name:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            UPDATE players
            SET is_online = 0,
                updated_at = ?
            WHERE lower(player_name) = lower(?)
        """, (
            now,
            player_name,
        ))

        conn.commit()


def mark_all_players_offline() -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            UPDATE players
            SET is_online = 0,
                updated_at = ?
            WHERE is_online != 0
        """, (
            now,
        ))

        conn.commit()


def add_player_access_history(
    category: str,
    action: str,

    target_uuid: str | None,
    target_name: str,

    account_type: str | None = None,

    operator_uuid: str | None = None,
    operator_name: str | None = None,

    source: str = "unknown",
    detail: str = "",

    expires_at: str | None = None,

    created_at: str | None = None
) -> None:
    
    if created_at is None:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO player_access_history (
                category,
                action,

                target_uuid,
                target_name,
                account_type,

                operator_uuid,
                operator_name,

                source,
                detail,
                     
                expires_at,

                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            category,
            action,

            target_uuid,
            target_name,
            account_type,

            operator_uuid,
            operator_name,

            source,
            detail,

            expires_at,

            created_at,
        ))

        trim_history_table(
            conn,
            "player_access_history",
        )

        conn.commit()


def update_player_op_since(
    player_uuid: str,
    player_name: str,
    account_type: str,
    op_since: str,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                op,
                op_since,
                updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                op = 1,
                op_since = excluded.op_since,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            op_since,
            now,
        ))

        conn.commit()


def update_player_whitelist_since(
    player_uuid: str,
    player_name: str,
    account_type: str,
    whitelisted_since: str,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                whitelisted,
                whitelisted_since,
                updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                whitelisted = 1,
                whitelisted_since = excluded.whitelisted_since,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            whitelisted_since,
            now,
        ))

        conn.commit()


def update_player_whitelist_status(
    player_uuid: str,
    player_name: str,
    account_type: str,
    whitelisted: bool,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                whitelisted,
                whitelisted_since,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                whitelisted = excluded.whitelisted,
                whitelisted_since = CASE
                    WHEN excluded.whitelisted = 1
                    THEN players.whitelisted_since
                    ELSE NULL
                END,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            1 if whitelisted else 0,
            None if whitelisted else None,
            now,
        ))

        conn.commit()


def update_player_ban_status(
    player_uuid: str,
    player_name: str,
    account_type: str,
    banned: bool,
    reason: str = "",
    expires_at: str | None = None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO players (
                player_uuid,
                player_name,
                account_type,
                banned,
                banned_since,
                ban_reason,
                ban_expires_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_uuid) DO UPDATE SET
                player_name = excluded.player_name,
                account_type = excluded.account_type,
                banned = excluded.banned,
                banned_since = CASE
                    WHEN excluded.banned = 1
                     AND players.banned = 1
                    THEN COALESCE(players.banned_since, excluded.banned_since)

                    WHEN excluded.banned = 1
                    THEN excluded.banned_since

                    ELSE NULL
                END,
                ban_reason = excluded.ban_reason,
                ban_expires_at = excluded.ban_expires_at,
                updated_at = excluded.updated_at
        """, (
            player_uuid,
            player_name,
            account_type,
            1 if banned else 0,
            now if banned else None,
            reason if banned else "",
            expires_at if banned else None,
            now,
        ))

        conn.commit()


def update_ip_ban_status(
    ip: str,
    banned: bool,
    reason: str = "",
    operator_name: str = "OxOcraft",
    operator_uuid: str | None = None,
    expires_at: str | None = None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    ip = str(ip or "").strip()
    reason = str(reason or "").strip()
    operator_name = str(operator_name or "OxOcraft").strip()
    operator_uuid = str(operator_uuid or "").strip() or None

    if not ip:
        return

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO ip_records (
                ip,
                banned,
                banned_since,
                ban_reason,
                ban_expires_at,
                operator_uuid,
                operator_name,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET
                banned = excluded.banned,
                banned_since = CASE
                    WHEN excluded.banned = 1
                    THEN COALESCE(ip_records.banned_since, excluded.banned_since)
                    ELSE NULL
                END,
                ban_reason = excluded.ban_reason,
                ban_expires_at = excluded.ban_expires_at,
                operator_uuid = excluded.operator_uuid,
                operator_name = excluded.operator_name,
                updated_at = excluded.updated_at
        """, (
            ip,
            1 if banned else 0,
            now if banned else None,
            reason if banned else "",
            expires_at if banned else None,
            operator_uuid,
            operator_name,
            now,
        ))

        conn.commit()


def get_whitelisted_players_from_db() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM players
            WHERE whitelisted = 1
            ORDER BY player_name COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def get_banned_players_from_db() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM players
            WHERE banned = 1
            ORDER BY player_name COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def get_banned_ips_from_db() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ip_records
            WHERE banned = 1
            ORDER BY ip COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def get_banned_ip_from_db(ip: str) -> dict | None:
    ip = str(ip or "").strip()

    if not ip:
        return None

    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM ip_records
            WHERE ip = ?
              AND banned = 1
            LIMIT 1
        """, (ip,)).fetchone()

    return dict(row) if row else None


def get_op_players_from_db() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM players
            WHERE op = 1
            ORDER BY player_name COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def sync_player_op_flags_from_uuid_set(
    op_uuid_set: set[str],
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    normalized = {
        str(player_uuid).lower()
        for player_uuid in op_uuid_set
        if player_uuid
    }

    with get_connection() as conn:
        if normalized:
            placeholders = ",".join("?" for _ in normalized)

            conn.execute(f"""
                UPDATE players
                SET op = 1,
                    op_since = COALESCE(op_since, ?),
                    updated_at = ?
                WHERE lower(player_uuid) IN ({placeholders})
            """, (
                now,
                now,
                *normalized,
            ))

            conn.execute(f"""
                UPDATE players
                SET op = 0,
                    op_since = NULL,
                    updated_at = ?
                WHERE lower(player_uuid) NOT IN ({placeholders})
                AND op != 0
            """, (
                now,
                *normalized,
            ))
        else:
            conn.execute("""
                UPDATE players
                SET op = 0,
                    op_since = NULL,
                    updated_at = ?
                WHERE op != 0
            """, (
                now,
            ))

        conn.commit()


def sync_player_whitelist_flags_from_uuid_set(
    whitelist_uuid_set: set[str],
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    normalized = {
        str(player_uuid).lower()
        for player_uuid in whitelist_uuid_set
        if player_uuid
    }

    with get_connection() as conn:
        if normalized:
            placeholders = ",".join("?" for _ in normalized)

            conn.execute(f"""
                UPDATE players
                SET whitelisted = 1,
                    updated_at = ?
                WHERE lower(player_uuid) IN ({placeholders})
            """, (
                now,
                *normalized,
            ))

            conn.execute(f"""
                UPDATE players
                SET whitelisted = 0,
                    updated_at = ?
                WHERE lower(player_uuid) NOT IN ({placeholders})
                  AND whitelisted != 0
            """, (
                now,
                *normalized,
            ))
        else:
            conn.execute("""
                UPDATE players
                SET whitelisted = 0,
                    updated_at = ?
                WHERE whitelisted != 0
            """, (
                now,
            ))

        conn.commit()


def get_banned_ips_from_db() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ip_records
            WHERE banned = 1
            ORDER BY ip COLLATE NOCASE ASC, updated_at DESC
        """).fetchall()

    return [dict(row) for row in rows]


def get_banned_ip_from_db(ip: str) -> dict | None:
    ip = str(ip or "").strip()

    if not ip:
        return None

    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM ip_records
            WHERE ip = ?
              AND banned = 1
            LIMIT 1
        """, (ip,)).fetchone()

    return dict(row) if row else None


def record_ip_ban_history(
    action: str,
    ip: str,
    reason: str = "",
    operator_name: str = "OxOcraft",
    operator_uuid: str | None = None,
    source: str = "unknown",
    detail: str = "",
    expires_at: str | None = None,
    created_at: str | None = None,
) -> None:
    action = str(action or "").strip()
    ip = str(ip or "").strip()
    reason = str(reason or "").strip()
    operator_name = str(operator_name or "OxOcraft").strip()
    operator_uuid = str(operator_uuid or "").strip() or None
    source = str(source or "unknown").strip()
    detail = str(detail or "").strip()

    if not action or not ip:
        return

    if created_at is None:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO ip_ban_history (
                action,
                ip,
                reason,
                operator_uuid,
                operator_name,
                source,
                detail,
                expires_at,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            action,
            ip,
            reason,
            operator_uuid,
            operator_name,
            source,
            detail,
            expires_at,
            created_at,
        ))

        trim_history_table(
            conn,
            "ip_ban_history",
        )

        conn.commit()


def trim_history_table(
    conn,
    table_name: str,
    limit: int = DEFAULT_HISTORY_LIMIT,
    trim_to: int = DEFAULT_HISTORY_TRIM_TO,
) -> None:
    count = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM {table_name}
        """
    ).fetchone()[0]

    if count <= limit:
        return

    conn.execute(
        f"""
        DELETE FROM {table_name}
        WHERE id IN (
            SELECT id
            FROM {table_name}
            ORDER BY created_at ASC, id ASC
            LIMIT ?
        )
        """,
        (count - trim_to,),
    )