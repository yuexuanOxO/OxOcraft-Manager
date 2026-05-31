export const SERVER_BUSY_STATES = new Set([
    "starting",
    "stopping",
    "backuping",
    "disconnected",
]);

export const SERVER_TRANSITION_STATES = new Set([
    "starting",
    "stopping",
]);

export function isServerBusyState(state) {
    return SERVER_BUSY_STATES.has(String(state || "offline"));
}

export function isServerTransitionState(state) {
    return SERVER_TRANSITION_STATES.has(String(state || "offline"));
}