const { runUpdateJob } = require('./ai_service');

let isRunning = false;
let loopTimeout = null;

async function setupSchedules() {
  if (isRunning) return;
  isRunning = true;
  
  console.log('Starting continuous scraping background process...');
  
  // 非同期で常時ループを開始
  startContinuousLoop();
}

async function startContinuousLoop() {
  while (isRunning) {
    console.log(`[Continuous Run - ${new Date().toISOString()}] Starting update...`);
    try {
      const newArticlesCount = await runUpdateJob();
      if (newArticlesCount > 0) {
        console.log(`[Continuous Run] Finished. ${newArticlesCount} new articles.`);
      } else {
        console.log(`[Continuous Run] No new articles found.`);
      }
    } catch (error) {
      console.error('Error during continuous run:', error);
    }

    // 1周終わったら、APIの制限を回避するため30分（1800000ミリ秒）待機
    console.log('Waiting for 30 minutes before the next run...');
    await new Promise(resolve => {
      loopTimeout = setTimeout(resolve, 30 * 60 * 1000);
    });
  }
}

// サーバー再起動やテスト用に一応リセット関数を残す
function stopSchedules() {
  isRunning = false;
  if (loopTimeout) clearTimeout(loopTimeout);
}

module.exports = {
  reloadSchedules: setupSchedules,
  stopSchedules
};
