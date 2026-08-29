

let notificationOffset = 0;
let notificationEventSource = null;
let notificationSseReconnectTimer = null;
let notificationSseStopped = false;

let selectedNotificationSource = "";

const notificationLimit = 10;

const NOTIFICATION_SOURCE_META = {
    backup: {
        label: "備份管理",
        icon: "/static/icons/feature_button/save_16b.png",
    },

    player_whitelist: {
        label: "白名單",
        icon: "/static/icons/feature_button/paper.png",
    },

    player_ban: {
        label: "黑名單",
        icon: "/static/icons/feature_button/barrier.png",
    },

    player_permission: {
        label: "權限管理",
        icon: "/static/icons/feature_button/command_block.gif",
    },

    world_settings: {
        label: "世界設定",
        icon: "/static/icons/feature_button/grass_block%20_btn.png",
    },
};

const DEFAULT_NOTIFICATION_SOURCE_META = {
    label: "系統通知",
    icon: "/static/icons/notification/notify.png",
};


function getNotificationElements() {
    return {
        bell: document.getElementById("notificationBell"),
        panel: document.getElementById("notificationPanel"),
        list: document.getElementById("notificationList"),
        exclamation: document.getElementById("notificationExclamation"),
        loadMoreBtn: document.getElementById("loadMoreNotificationsBtn"),

        categoryScroll:
            document.getElementById("notificationCategoryScroll"),

        categoryPrev:
            document.getElementById("notificationCategoryPrev"),

        categoryNext:
            document.getElementById("notificationCategoryNext"),
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
    const sourceMeta =
        NOTIFICATION_SOURCE_META[item.source]
        || DEFAULT_NOTIFICATION_SOURCE_META;

    return `
        <div class="notification-item">

            <div class="notification-item-icon">
                <img
                    src="${escapeHtml(sourceMeta.icon)}"
                    alt=""
                >
            </div>

            <div class="notification-item-meta">
                <div class="notification-item-source">
                    ${escapeHtml(sourceMeta.label)}
                </div>

                <div class="notification-item-title">
                    ${escapeHtml(item.title)}
                </div>
            </div>

            <div class="notification-item-body">
                <div class="notification-item-message">
                    ${escapeHtml(item.message)}
                </div>

                <div class="notification-item-time">
                    ${escapeHtml(item.created_at)}
                </div>
            </div>

        </div>
    `;
}

async function loadNotifications(
    { reset = false } = {}
) {
    const {
        list,
        loadMoreBtn,
    } = getNotificationElements();

    if (!list) {
        return;
    }

    const requestedSource =
        selectedNotificationSource;

    if (reset) {
        notificationOffset = 0;
        list.innerHTML = "";
        list.scrollTop = 0;
    }

    const params =
        new URLSearchParams({
            limit: String(
                notificationLimit
            ),
            offset: String(
                notificationOffset
            ),
        });

    if (requestedSource) {
        params.set(
            "source",
            requestedSource
        );
    }

    const res = await fetch(
        `/api/notifications?${params.toString()}`
    );

    const data = await res.json();

    /*
     * 使用者如果快速切換分類，
     * 舊分類的 request 可能比較晚回來。
     * 這時不要把舊結果畫到新分類。
     */
    if (
        requestedSource
        !== selectedNotificationSource
    ) {
        return;
    }

    const notifications =
        data.notifications || [];

    if (
        reset
        && notifications.length === 0
    ) {
        list.innerHTML = `
            <div class="notification-empty">
                目前沒有通知
            </div>
        `;
    } else {
        list.insertAdjacentHTML(
            "beforeend",
            notifications
                .map(renderNotificationItem)
                .join("")
        );
    }

    notificationOffset +=
        notifications.length;

    if (loadMoreBtn) {
        loadMoreBtn.classList.toggle(
            "hidden",
            notifications.length
                < notificationLimit
        );
    }
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

        const matchesSelectedSource =
            !selectedNotificationSource
            || notification.source
                === selectedNotificationSource;

        if (
            panel &&
            list &&
            !panel.classList.contains("hidden")
            && matchesSelectedSource
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

        if (notificationSseStopped) return;

        if (notificationSseReconnectTimer) {
            clearTimeout(notificationSseReconnectTimer);
        }

        notificationSseReconnectTimer = setTimeout(() => {
            if (!notificationSseStopped) {
                connectNotificationEvents();
            }
        }, 3000);
    };
}


function setupNotificationCategoryScroll() {
    const {
        categoryScroll,
        categoryPrev,
        categoryNext,
    } = getNotificationElements();

    if (!categoryScroll) {
        return;
    }

    const categoryButtons =
        categoryScroll.querySelectorAll(
            ".notification-category-btn"
        );

    const scrollAmount = 96;

    categoryPrev?.addEventListener(
        "click",
        () => {
            categoryScroll.scrollBy({
                left: -scrollAmount,
                behavior: "smooth",
            });
        }
    );

    categoryNext?.addEventListener(
        "click",
        () => {
            categoryScroll.scrollBy({
                left: scrollAmount,
                behavior: "smooth",
            });
        }
    );

    categoryScroll.addEventListener(
        "wheel",
        (event) => {
            const delta =
                event.deltaY !== 0
                    ? event.deltaY
                    : event.deltaX;

            if (delta === 0) {
                return;
            }

            event.preventDefault();

            categoryScroll.scrollBy({
                left: delta > 0 ? 48 : -48,
                behavior: "smooth",
            });
            
        },
        {
            passive: false,
        }
    );

    categoryButtons.forEach((button) => {
        button.addEventListener(
            "click",
            async () => {
                const nextSource =
                    button.dataset.source || "";

                if (
                    selectedNotificationSource
                    === nextSource
                ) {
                    return;
                }

                selectedNotificationSource =
                    nextSource;

                categoryButtons.forEach(
                    (categoryButton) => {
                        categoryButton
                            .classList
                            .toggle(
                                "active",
                                categoryButton
                                    === button
                            );
                    }
                );

                await loadNotifications({
                    reset: true,
                });
            }
        );
    });


}


export function initNotificationUI() {
    const { bell, panel, loadMoreBtn } = getNotificationElements();

    if (!bell || !panel) return;

    setupNotificationCategoryScroll();

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

    window.addEventListener("server-status-changed", (event) => {
        if (event.detail?.state === "disconnected") {
            stopNotificationEvents();
        }
    });

}

function stopNotificationEvents() {
    notificationSseStopped = true;

    if (notificationSseReconnectTimer) {
        clearTimeout(notificationSseReconnectTimer);
        notificationSseReconnectTimer = null;
    }

    if (notificationEventSource) {
        notificationEventSource.close();
        notificationEventSource = null;
    }
}