const mongoose = require('mongoose');
const { runUpdateJob, sendLineNotification } = require('./ai_service');

let isRunning = false;
let loopTimeout = null;

async function setupSchedules() {
  if (isRunning) return;
  isRunning = true;
  
  console.log('Starting continuous scraping and sleep-resistant notification background process...');
  
  // 非同期で常時ループ（スクレイピング＆通知チェック）を開始
  startContinuousLoop();
}

async function checkScheduledNotifications() {
  try {
    const now = new Date();
    // 日本時間に変換
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const jstHour = jstNow.getUTCHours();
    
    let targetHour = -1;
    let sinceHours = 6;
    
    // 18時以降なら18時の通知、12時以降なら12時の通知、6時以降なら6時の通知
    if (jstHour >= 18) { targetHour = 18; sinceHours = 6; }
    else if (jstHour >= 12) { targetHour = 12; sinceHours = 6; }
    else if (jstHour >= 6) { targetHour = 6; sinceHours = 12; }
    
    if (targetHour !== -1) {
      // 日付文字列 (例: "2026-07-12") と targetHour を組み合わせて一意のIDを作成
      const dateStr = jstNow.toISOString().split('T')[0];
      const notifyId = \line_\_\\;
      
      const collection = mongoose.connection.db.collection('system_status');
      
      // その通知がすでに送信されているか確認
      const doc = await collection.findOne({ _id: notifyId });
      if (!doc) {
        console.log(\[Notification] Triggering sleep-resistant notification for \:00...\);
        
        // sinceTimeを計算 (現在の実際の日時から指定時間前を遡る)
        const sinceTime = new Date();
        sinceTime.setHours(sinceTime.getHours() - sinceHours);
        
        await sendLineNotification(sinceTime);
        
        // 送信済みとして記録
        await collection.updateOne(
          { _id: notifyId },
          { $set: { sent_at: new Date() } },
          { upsert: true }
        );
        console.log(\[Notification] Marked \ as sent.\);
      }
    }
  } catch (err) {
    console.error('Error checking scheduled notifications:', err);
  }
}

async function startContinuousLoop() {
  while (isRunning) {
    console.log(\[Continuous Run - \] Starting update...\);
    try {
      const newArticlesCount = await runUpdateJob();
      if (newArticlesCount > 0) {
        console.log(\[Continuous Run] Finished. \ new articles.\);
      } else {
        console.log(\[Continuous Run] No new articles found.\);
      }
      
      // 巡回後に必ず通知のチェックを行う（Sleep復帰時のための対策）
      await checkScheduledNotifications();
      
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

function stopSchedules() {
  isRunning = false;
  if (loopTimeout) clearTimeout(loopTimeout);
}

module.exports = {
  reloadSchedules: setupSchedules,
  stopSchedules
};
