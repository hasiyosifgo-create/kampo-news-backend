const cron = require('node-cron');
const { runUpdateJob, sendLineNotification } = require('./ai_service');

let isRunning = false;
let loopTimeout = null;
let activeJobs = [];

async function setupSchedules() {
  if (isRunning) return;
  isRunning = true;
  
  console.log('Starting continuous scraping background process...');
  
  // 非同期で常時ループ（スクレイピング）を開始
  startContinuousLoop();

  // LINE通知用のスケジュールを設定
  setupNotificationCron();
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

function setupNotificationCron() {
  // 古いジョブがあれば停止
  activeJobs.forEach(job => job.stop());
  activeJobs = [];

  const times = [
    { time: '06:00', sinceHours: 12 }, // 06:00通知は、前日18:00〜06:00の12時間分
    { time: '12:00', sinceHours: 6 },  // 12:00通知は、当日06:00〜12:00の6時間分
    { time: '18:00', sinceHours: 6 }   // 18:00通知は、当日12:00〜18:00の6時間分
  ];

  times.forEach(({ time, sinceHours }) => {
    const [hour, minute] = time.split(':');
    const cronExpression = `${minute} ${hour} * * *`;
    
    const job = cron.schedule(cronExpression, async () => {
      console.log(`[Scheduled Notification - ${time}] Checking for new articles...`);
      try {
        const sinceTime = new Date();
        sinceTime.setHours(sinceTime.getHours() - sinceHours);
        
        await sendLineNotification(sinceTime);
      } catch (error) {
        console.error('Error during scheduled LINE notification:', error);
      }
    }, {
      timezone: "Asia/Tokyo"
    });
    
    activeJobs.push(job);
    console.log(`Scheduled LINE notification job for ${time} (fetching past ${sinceHours} hours)`);
  });
}

function stopSchedules() {
  isRunning = false;
  if (loopTimeout) clearTimeout(loopTimeout);
  activeJobs.forEach(job => job.stop());
  activeJobs = [];
}

module.exports = {
  reloadSchedules: setupSchedules,
  stopSchedules
};
