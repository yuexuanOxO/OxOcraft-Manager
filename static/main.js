async function updateLog() {
    try {
        const response = await fetch("/log");
        const data = await response.json();

        const logBox = document.getElementById("logBox");
        logBox.textContent = data.logs;

        // 自動捲到最底
        logBox.scrollTop = logBox.scrollHeight;
    } catch (error) {
        console.error("更新 log 失敗:", error);
    }
}


async function updateStatus(){
    try{
        const response = await fetch("/status");
        const data = await response.json();

        const statusLight = document.getElementById("statusLight");
        const statusText = document.getElementById("statusText");

        if(data.online){
            statusLight.classList.remove("offline");
            statusLight.classList.add("online");
            statusText.textContent = "在線";
        }else{
            statusLight.classList.remove("online");
            statusLight.classList.add("offline");
            statusText.textContent = "離線";
        }

    }catch(error){
        console.error("更新狀態失敗:", error);
    }
}

//開啟後先初始化抓取server狀態
updateStatus();

// 頁面載入後每 2 秒更新一次log
setInterval(updateLog, 2000);

setInterval(updateStatus,2000);
