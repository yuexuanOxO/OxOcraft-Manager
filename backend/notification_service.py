from __future__ import annotations

from datetime import datetime, timedelta
from backend.db import get_connection
from queue import Queue


NOTIFICATION_KEEP_LIMIT = 500
NOTIFICATION_KEEP_DAYS = 30
_notification_listeners: list[Queue] = []


def create_notification(
    title: str,
    message: str,
    type: str = "info",
    source: str | None = None,
    is_important: bool = False,
) -> dict:
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO notifications (
                type,
                title,
                message,
                source,
                is_read,
                is_important,
                created_at
            )
            VALUES (?, ?, ?, ?, 0, ?, ?)
        """, (
            type,
            title,
            message,
            source,
            1 if is_important else 0,
            created_at,
        ))

        notification_id = cursor.lastrowid
        conn.commit()

        row = conn.execute("""
            SELECT *
            FROM notifications
            WHERE id = ?
        """, (notification_id,)).fetchone()

    cleanup_notifications_if_needed()

    notification = dict(row)

    publish_notification_event(notification)

    return notification


def get_notifications(limit: int = 10, offset: int = 0) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM notifications
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()

    return [dict(row) for row in rows]


def get_unread_notification_count() -> int:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT COUNT(*) AS count
            FROM notifications
            WHERE is_read = 0
        """).fetchone()

    return int(row["count"])


def mark_all_notifications_read() -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE notifications
            SET is_read = 1
            WHERE is_read = 0
        """)
        conn.commit()


def cleanup_notifications_if_needed() -> None:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT COUNT(*) AS count
            FROM notifications
        """).fetchone()

        total = int(row["count"])

        if total <= NOTIFICATION_KEEP_LIMIT:
            return

        cutoff = datetime.now() - timedelta(days=NOTIFICATION_KEEP_DAYS)
        cutoff_text = cutoff.strftime("%Y-%m-%d %H:%M:%S")

        conn.execute("""
            DELETE FROM notifications
            WHERE created_at < ?
              AND is_important = 0
        """, (cutoff_text,))

        conn.commit()

def subscribe_notification_events() -> Queue:
    queue = Queue()
    _notification_listeners.append(queue)
    return queue


def unsubscribe_notification_events(queue: Queue) -> None:
    if queue in _notification_listeners:
        _notification_listeners.remove(queue)


def publish_notification_event(notification: dict) -> None:
    dead_queues = []

    for queue in _notification_listeners:
        try:
            queue.put(notification)
        except Exception:
            dead_queues.append(queue)

    for queue in dead_queues:
        unsubscribe_notification_events(queue)