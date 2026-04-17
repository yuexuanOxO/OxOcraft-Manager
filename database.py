import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "oxocraft.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
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
        conn.commit()


def insert_player_death(player_name, death_type, death_text, killer, item, x, y, z, dimension, raw_log):
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO player_deaths (
                player_name, death_type, death_text, killer, item,
                x, y, z, dimension, raw_log
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            player_name, death_type, death_text, killer, item,
            x, y, z, dimension, raw_log
        ))

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


def get_recent_player_deaths(limit=10):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM player_deaths
            ORDER BY death_time DESC, id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]