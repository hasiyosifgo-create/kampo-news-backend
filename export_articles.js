require('dotenv').config();
const { Article } = require('./database');
const mongoose = require('mongoose');
const fs = require('fs');

async function exportArticles() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const articles = await Article.find({ is_duplicate: { $ne: true } })
      .sort({ published_at: -1, created_at: -1 })
      .limit(200)
      .lean();
    console.log('Fetched articles:', articles.length);
    if (!fs.existsSync('./public')) {
      fs.mkdirSync('./public', { recursive: true });
    }
    fs.writeFileSync('./public/articles.json', JSON.stringify(articles, null, 2));
    console.log('Successfully wrote public/articles.json');
  } catch (err) {
    console.error('Export error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  exportArticles();
}

module.exports = { exportArticles };
