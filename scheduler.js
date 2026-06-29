const cron = require('node-cron');
const { runUpdateJob } = require('./ai_service');

let activeJobs = [];

async function setupSchedules() {
  activeJobs.forEach(job => job.stop());
  activeJobs = [];

  const times = ['06:00', '12:00', '18:00'];

  times.forEach(time => {
    const [hour, minute] = time.split(':');
    const cronExpression = `${minute} ${hour} * * *`;
    
    const job = cron.schedule(cronExpression, async () => {
      console.log(`[Scheduled Run - ${time}] Starting update...`);
      try {
        const newArticlesCount = await runUpdateJob();
        if (newArticlesCount > 0) {
          console.log(`[Scheduled Run - ${time}] Finished. ${newArticlesCount} new articles.`);
        } else {
          console.log(`[Scheduled Run - ${time}] No new articles found.`);
        }
      } catch (error) {
        console.error('Error during scheduled run:', error);
      }
    }, {
      timezone: "Asia/Tokyo"
    });
    
    activeJobs.push(job);
    console.log(`Scheduled job for ${time}`);
  });
}

module.exports = {
  reloadSchedules: setupSchedules
};
