let notificationOffset = 0;
let notificationEventSource = null;
const notificationLimit = 10;


function getNotificationElements() {
    return {
        bell: document.getElementById("notificationBell"),
        panel: document.getElementById("notificationPanel"),
        list: document.getElementById("notificationList"),
        exclamation: document.getElementById("notificationExclamation"),
        loadMoreBtn: document.getElementById("loadMoreNotificationsBtn"),
    };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderNotificationItem(item) {
    const type = item.type || "info";

    return `
        <div class="notification-item ${escapeHtml(type)}">
            <div class="notification-item-title">${escapeHtml(item.title)}</div>
            <div class="notification-item-message">${escapeHtml(item.message)}</div>
            <div class="notification-item-time">${escapeHtml(item.created_at)}</div>
        </div>
    `;
}

async function loadNotifications({ reset = false } = {}) {
    const { list, exclamation } = getNotificationElements();

    if (!list) return;

    if (reset) {
        notificationOffset = 0;
        list.innerHTML = "";
    }

    const res = await fetch(`/api/notifications?limit=${notificationLimit}&offset=${notificationOffset}`);
    const data = await res.json();

    const notifications = data.notifications || [];

    if (reset && notifications.length === 0) {
        list.innerHTML = `<div class="notification-empty">目前沒有通知</div>`;
    } else {
        list.insertAdjacentHTML(
            "beforeend",
            notifications.map(renderNotificationItem).join("")
        );
    }

    notificationOffset += notifications.length;

}

async function updateUnreadNotificationBadge() {
    const { bell } = getNotificationElements();

    if (!bell) return;

    const res = await fetch("/api/notifications/unread-count");
    const data = await res.json();

    const unread = Number(data.unread_count || 0);

    bell.classList.toggle("has-unread", unread > 0);
}

async function markAllNotificationsRead() {
    const { bell } = getNotificationElements();

    await fetch("/api/notifications/mark-all-read", {
        method: "POST",
    });

    if (bell) {
        bell.classList.remove("has-unread");
    }
}


function connectNotificationEvents() {
    if (notificationEventSource) {
        notificationEventSource.close();
    }

    notificationEventSource = new EventSource("/api/notifications/events");

    notificationEventSource.addEventListener("notification", async (event) => {
        const notification = JSON.parse(event.data);

        const { bell, panel, list } = getNotificationElements();

        if (bell) {
            bell.classList.add("has-unread");
        }

        if (
            panel &&
            list &&
            !panel.classList.contains("hidden")
        ) {
            const empty = list.querySelector(".notification-empty");

            if (empty) {
                empty.remove();
            }

            list.insertAdjacentHTML(
                "afterbegin",
                renderNotificationItem(notification)
            );

            notificationOffset += 1;
        }
    });

    notificationEventSource.onerror = () => {
        console.warn("[Notification] SSE disconnected");

        setTimeout(() => {
            connectNotificationEvents();
        }, 3000);
    };
}


export function initNotificationUI() {
    const { bell, panel, loadMoreBtn } = getNotificationElements();

    if (!bell || !panel) return;

    bell.addEventListener("click", async () => {
        const willOpen = panel.classList.contains("hidden");

        panel.classList.toggle("hidden");

        if (willOpen) {
            await loadNotifications({ reset: true });
            await markAllNotificationsRead();
        }
    });

    document.addEventListener("click", (event) => {
        const clickedInsidePanel = panel.contains(event.target);
        const clickedBell = bell.contains(event.target);

        if (!clickedInsidePanel && !clickedBell) {
            panel.classList.add("hidden");
        }
    });

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
            loadNotifications({ reset: false });
        });
    }

    updateUnreadNotificationBadge();
    connectNotificationEvents();

}