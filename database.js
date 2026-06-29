const mongoose = require('mongoose');

// Mongooseのスキーマ定義
const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  url: { type: String, required: true, unique: true },
  published_at: { type: Date, required: true },
  original_content: { type: String },
  translated_title: { type: String },
  summary: { type: String },
  tags: { type: String }, // JSON形式の文字列
  translated_content: { type: String },
  topic_name: { type: String },
  category: { type: String, default: 'news' },
  created_at: { type: Date, default: Date.now }
});

const Article = mongoose.model('Article', articleSchema);
// MongoDB接続関数
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn('MONGO_URI is not set. Database connection skipped.');
    return;
  }
  
  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully.');
    
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err; // ここでエラーを投げて後続のDB処理を止める
  }
}

module.exports = {
  connectDB,
  Article
};
