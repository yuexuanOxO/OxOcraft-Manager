let uiServerState = "offline";
let uiServerOnline = false;
let busyMode = null;
let busyUnlockAt = 0;
let recheckTimer = null;

const UI_BUSY_MIN_MS = 1000;

function isTransitionState(state) {
    return state === "starting" || state === "stopping";
}

function emitUiServerStateChanged() {
    window.dispatchEvent(new CustomEvent(
        "server-ui-state-changed",
        {
            detail: {
                state: getUiServerState(),
                rawState: uiServerState,
                online: uiServerOnline,
                busyMode
            }
        }
    ));
}

function scheduleRecheck() {
    if (recheckTimer) return;

    const delay = Math.max(0, busyUnlockAt - Date.now());

    recheckTimer = window.setTimeout(() => {
        recheckTimer = null;
        refreshUiServerState();
    }, delay + 50);
}

export function updateUiServerState(data) {
    uiServerState = data?.state || "offline";
    uiServerOnline = !!data?.online;

    refreshUiServerState();
}

function refreshUiServerState() {
    const state = uiServerState;
    const online = uiServerOnline;
    const now = Date.now();

    if (isTransitionState(state)) {
        busyMode = state;
        busyUnlockAt = now + UI_BUSY_MIN_MS;
    }

    if (busyMode) {
        const canUnlock = now >= busyUnlockAt;

        if (
            busyMode === "starting" &&
            state !== "starting" &&
            canUnlock
        ) {
            busyMode = null;

        } else if (
            busyMode === "stopping" &&
            !online &&
            state !== "starting" &&
            canUnlock
        ) {
            busyMode = null;

        } else {
            scheduleRecheck();
        }
    }

    // console.log("[UI State]", {
    //     rawState: uiServerState,
    //     online: uiServerOnline,
    //     busyMode,
    //     uiState: getUiServerState(),
    //     unlockIn: busyUnlockAt - Date.now()
    // });

    emitUiServerStateChanged();
}

export function getUiServerState() {
    return busyMode || uiServerState;
}

export function isUiServerTransitionState() {
    const state = getUiServerState();

    return (
        state === "starting" ||
        state === "stopping"
    );
}