export function initFeatureCards() {
    const globalCard = document.getElementById("globalFeatureCard");
    const globalButtonHost = document.getElementById("globalFeatureButtonHost");
    const featureItems = document.querySelectorAll(".feature-item");

    if (!globalCard || !globalButtonHost || !featureItems.length) return;

    let hideTimer = null;
    let activeButton = null;
    let activePlaceholder = null;
    let activeOriginalParent = null;
    let activeItem = null;

    function cancelHide() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function restoreButton() {
        if (activeButton && activeOriginalParent) {
            if (activePlaceholder && activePlaceholder.parentNode) {
                activePlaceholder.parentNode.replaceChild(activeButton, activePlaceholder);
            } else {
                activeOriginalParent.appendChild(activeButton);
            }
        }

        activeButton = null;
        activePlaceholder = null;
        activeOriginalParent = null;
        activeItem = null;

        globalButtonHost.classList.add("hidden");
        globalButtonHost.innerHTML = "";

        globalCard.classList.add("hidden");
        globalCard.innerHTML = "";
    }

    function scheduleHide() {
        cancelHide();
        hideTimer = setTimeout(() => {
            restoreButton();
        }, 80);
    }

    function showCard(item) {
        const sourceCard = item.querySelector(".feature-hover-card");
        const btn = item.querySelector(".feature-btn");

        if (!sourceCard || !btn) return;

        cancelHide();

        // 如果已經是目前這顆，就不要重複搬移，避免一直重置
        if (activeItem === item) {
            return;
        }

        // 如果目前已有其他顆在外層，先還原
        if (activeButton) {
            restoreButton();
        }

        const rect = btn.getBoundingClientRect();
        const roundedLeft = Math.round(rect.left);
        const roundedTop = Math.round(rect.top);

        globalCard.innerHTML = sourceCard.innerHTML;
        globalCard.classList.remove("hidden");
        globalCard.style.left = `${roundedLeft - 15}px`;
        globalCard.style.top = `${roundedTop - 4}px`;

        activeButton = btn;
        activeOriginalParent = btn.parentNode;
        activeItem = item;

        const placeholder = document.createElement("div");
        placeholder.className = "feature-btn-placeholder";
        activePlaceholder = placeholder;

        activeOriginalParent.replaceChild(placeholder, btn);

        globalButtonHost.classList.remove("hidden");
        globalButtonHost.style.left = `${roundedLeft}px`;
        globalButtonHost.style.top = `${roundedTop}px`;
        globalButtonHost.innerHTML = "";
        globalButtonHost.appendChild(btn);
    }

    featureItems.forEach((item) => {
        item.addEventListener("mouseenter", () => {
            showCard(item);
        });

        item.addEventListener("mouseleave", (event) => {
            const toElement = event.relatedTarget;

            // 如果滑鼠是移到外層按鈕 host，不要關閉
            if (toElement && globalButtonHost.contains(toElement)) {
                return;
            }

            scheduleHide();
        });
    });

    globalButtonHost.addEventListener("mouseenter", () => {
        cancelHide();
    });

    globalButtonHost.addEventListener("mouseleave", (event) => {
        const toElement = event.relatedTarget;

        // 如果滑鼠從外層按鈕又回到原本某個 feature-item，就不要關閉
        const movedToFeatureItem = Array.from(featureItems).some((item) => {
            return toElement && item.contains(toElement);
        });

        if (movedToFeatureItem) {
            return;
        }

        scheduleHide();
    });

    window.addEventListener("scroll", () => {
        restoreButton();
    }, true);

    window.addEventListener("resize", () => {
        restoreButton();
    });
}