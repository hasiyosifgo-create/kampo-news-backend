const express = require('express');
const cors = require('cors');
const { connectDB, Article } = require('./database');
const scheduler = require('./scheduler');
const aiService = require('./ai_service');
const axios = require('axios');

// MongoDBに接続してからスケジューラを起動する
connectDB().then(() => {
  console.log('Initializing scheduler...');
  scheduler.reloadSchedules();
}).catch(err => console.error('Failed to init app:', err));

// server起動時に環境変数を読み込む
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;
const path = require('path');

// モバイルアプリからのアクセスを許可するためにCORSを緩める
app.use(cors({
  origin: '*'
}));
app.use(express.json());

// フロントエンド（静的ファイル）の配信
app.use(express.static(path.join(__dirname, 'public')));

// ==== API Routes ====

// 0. ジョブの実行状態取得
app.get('/api/status', (req, res) => {
  res.json(aiService.getStatus());
});

// 1. 記事一覧の取得
app.get('/api/articles', async (req, res) => {
  try {
    const { category, tag } = req.query;
    let query = {};
    if (category) {
      query.category = category;
    }
    
    // 全件取得してソート（フロントエンドでのタグ絞り込みにも対応可能にするため）
    let articles = await Article.find(query).sort({ published_at: -1 }).lean();
    
    // フロントエンドが配列として扱えるように tags をパース
    articles = articles.map(a => {
      try {
        a.tags = typeof a.tags === 'string' ? JSON.parse(a.tags) : (a.tags || []);
      } catch(e) {
        a.tags = [];
      }
      return a;
    });
    
    // タグが指定されていればフィルタリング
    if (tag) {
      articles = articles.filter(a => {
        return Array.isArray(a.tags) && a.tags.includes(tag);
      });
    }
    
    res.json(articles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// 2. 利用可能な全タグ一覧の取得（絞り込みUI用）
app.get('/api/tags', async (req, res) => {
  try {
    const articles = await Article.find({}, 'tags').lean();
    const tagSet = new Set();
    articles.forEach(a => {
      try {
        const tags = JSON.parse(a.tags || '[]');
        tags.forEach(t => tagSet.add(t));
      } catch(e) {}
    });
    // 企業名（特定のアクションタグ以外）を後方にするためのソートロジック
    const actionTags = ['発売', '終了', '回収', '出荷'];
    const sortedTags = Array.from(tagSet).sort((a, b) => {
      const aIsAction = actionTags.includes(a);
      const bIsAction = actionTags.includes(b);
      if (aIsAction && !bIsAction) return -1;
      if (!aIsAction && bIsAction) return 1;
      return a.localeCompare(b, 'ja');
    });
    
    res.json(sortedTags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// 記事の一括削除（履歴リセット）
app.delete('/api/articles', async (req, res) => {
  try {
    await Article.deleteMany({});
    res.json({ success: true, message: 'All articles deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete articles' });
  }
});



// 6. 手動更新の実行
app.post('/api/update', async (req, res) => {
  try {
    // 既に更新中の場合はエラー（aiService内でisUpdatingが管理されているが、フロントエンドから status を見て制御もする）
    const status = aiService.getStatus();
    if (status.isUpdating) {
      return res.status(400).json({ error: 'Already updating' });
    }
    
    // 非同期で実行（レスポンスはすぐに返す）
    aiService.runUpdateJob().catch(err => console.error('Manual update failed:', err));
    
    res.json({ success: true, message: 'Update started' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start update' });
  }
});

// 7. RenderのSleep回避用Pingエンドポイント
app.get('/api/ping', (req, res) => {
  res.send('OK');
});

// サーバー起動
// ==== Catch-all route for SPA ====
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Renderの自動スリープを防止するために14分ごとに自分自身を叩く
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_EXTERNAL_URL) {
    console.log('Starting self-ping to prevent sleep on:', RENDER_EXTERNAL_URL);
    setInterval(() => {
      axios.get(`${RENDER_EXTERNAL_URL}/api/ping`).catch(() => {});
    }, 14 * 60 * 1000); // 14分ごとに実行
  }
});
