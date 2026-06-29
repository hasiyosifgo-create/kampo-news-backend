const axios = require('axios');
const Parser = require('rss-parser');
const { Article } = require('./database');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
require('dotenv').config();
const turndownService = new TurndownService();
const parser = new Parser();

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
let genAI = null;

const FALLBACK_MODELS = [
  // 上限が大きいモデル（安定して使えるもの）
  "gemini-3.1-flash-lite",    // RPD 500
  "gemma-4-31b-it",           // RPD 1500
  "gemma-4-26b-a4b-it",       // RPD 1500
  // 上限が小さいモデル（RPD 20）
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  // 最新の自動割当モデル
  "gemini-flash-latest",
  "gemini-flash-lite-latest"
];
let currentModelIndex = 0;

function getModel() {
  if (!genAI) return null;
  return genAI.getGenerativeModel({
    model: FALLBACK_MODELS[currentModelIndex],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          summary: { type: SchemaType.STRING },
          tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          topic_name: { type: SchemaType.STRING }
        },
        required: ["summary", "tags", "topic_name"]
      }
    }
  });
}

if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// 実行中の状態を保持
let isUpdating = false;
let lastUpdateCount = 0;

// 漢方・生薬ニュースを取得する（Bing News & Note RSS）
async function fetchAINews() {
  const bingQueries = [
    '漢方', '生薬', 'ツムラ', 'クラシエ', '小太郎漢方', 'イスクラ',
    'JPS漢方', '三和生薬', '東洋薬行', '日邦薬品', '救心製薬', '大和製薬',
    '日本粉末薬品', '滝沢漢方', 'ウチダ和漢薬', '栃本天海堂', '小林製薬',
    '井藤漢方', '剤盛堂', 'ホノミ漢方', '松浦薬業'
  ];
  const noteTags = ['漢方', '生薬'];
  const results = [];

  // Bing News RSS
  for (const q of bingQueries) {
    try {
      const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&cc=jp`;
      const feed = await parser.parseURL(url);
      results.push(...feed.items.slice(0, 10).map(item => {
        // Bingのapiclickから元のURLを抽出
        let linkUrl = item.link;
        if (linkUrl.includes('bing.com/news/apiclick')) {
          try {
            const parsed = new URL(linkUrl);
            const realUrl = parsed.searchParams.get('url');
            if (realUrl) linkUrl = realUrl;
          } catch(e) {}
        }
        return {
          title: item.title,
          link: linkUrl,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet || item.content,
          category: 'news',
          isDirectScrape: false
        };
      }));
    } catch (e) {
      console.warn('Bing RSS parse error:', e.message);
    }
  }

  // Note.com RSS
  for (const tag of noteTags) {
    try {
      const url = `https://note.com/hashtag/${encodeURIComponent(tag)}/rss`;
      const feed = await parser.parseURL(url);
      results.push(...feed.items.slice(0, 5).map(item => ({
        title: `【Note】${item.title}`,
        link: item.link,
        pubDate: item.pubDate,
        contentSnippet: item.contentSnippet || item.content,
        category: 'news',
        isDirectScrape: false
      })));
    } catch (e) {
      console.warn('Note RSS parse error:', e.message);
    }
  }

  return results;
}

async function fetchPharmaSitesViaRSS() {
  let results = [];
  
  // 直接スクレイピングによる取得（Google Newsでヒットしないマイナー企業用）
  const directSites = [
    { name: 'ツムラ', url: 'https://www.tsumura.co.jp/newsroom/' },
    { name: 'クラシエ', url: 'https://www.kracie.co.jp/release/' },
    { name: '小太郎漢方', url: 'https://www.kotaro.co.jp/category/news_release/' },
    { name: 'イスクラ', url: 'https://www.iskra.co.jp/' },
    { name: 'JPS漢方', url: 'https://www.jps-kampo.co.jp/' },
    { name: '三和生薬', url: 'https://www.sanwashoyaku.co.jp/' },
    { name: 'ホノミ漢方', url: 'https://www.zaiseido.co.jp/topics/' },
    { name: '松浦薬業', url: 'https://www.matsuura-gp.co.jp/news/' }
  ];

  for (const site of directSites) {
    try {
      const response = await axios.get(site.url, { timeout: 10000 });
      const finalBaseUrl = response.request.res.responseUrl || site.url;
      const dom = new JSDOM(response.data);
      const links = Array.from(dom.window.document.querySelectorAll('a'))
        .filter(a => a.href && a.textContent)
        .map(a => {
          const container = a.closest('li, tr, dt, dd, article, section') || a.parentElement || a;
          return { 
            href: new URL(a.href, finalBaseUrl).href, 
            text: a.textContent.trim().replace(/\s+/g, ' '),
            containerText: container.textContent.trim().replace(/\s+/g, ' ')
          };
        });

      let extractedCount = 0;
      for (const link of links) {
        // 短すぎるリンクテキストや無関係なナビゲーションを除外
        if (link.text.length < 5 || link.text.includes('プライバシー') || link.text.includes('会社概要')) {
          continue;
        }

        // 過去の日付（例: 2023.01）などが含まれる古いリンクをできるだけ除外
        const dateMatch = link.containerText.match(/(20\d{2})[\/\.年](0?[1-9]|1[0-2])/);
        let pubDateStr = '';
        if (dateMatch) {
          const year = parseInt(dateMatch[1], 10);
          if (year < new Date().getFullYear() - 1) continue; // 1年以上前はスキップ
          pubDateStr = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-01`;
        }

        if (extractedCount >= 5) break; // 各サイト最大5件まで

        results.push({
          title: `【${site.name} 公式】${link.text}`,
          link: link.href,
          pubDate: pubDateStr,
          category: 'product',
          contentSnippet: link.text,
          isDirectScrape: true // 短いコンテンツのスキップ回避用
        });
        extractedCount++;
      }
    } catch (e) {
      console.warn(`Failed to fetch pharma site directly ${site.name}:`, e.message);
    }
  }

  return results;
}

async function processArticleWithGemini(articleText, title, category) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is missing or invalid.');
  }

  let prompt = '';
  if (category === 'product') {
    prompt = `
以下の日本語のニュース記事（漢方や生薬に関するもの）を読んで、要約と情報を抽出してください。
※本文全体の翻訳や出力は不要です。

【タイトル】
${title}

【本文】
${articleText}

以下の要件を満たす情報をJSONフォーマットで出力してください。
- summary: 記事の要約（3〜4文程度でわかりやすく。※対象製品名と理由・時期が必ず含まれるようにしてください）。もし記事が「漢方薬・生薬・医薬品・健康食品」と全く無関係な一般的なお菓子（キャンディ、グミ、知育菓子など）や日用品のニュースである場合は、\`UNRELATED\` という文字列だけを出力してください。
- tags: 「アクション（発売、終了、回収、出荷のいずれか）」と「対象の企業名」の2つのみを必ず配列として出力してください。（例: ["発売", "クラシエ"], ["回収", "松浦薬業"] 等）
- topic_name: この記事が扱っている主要な「ニュースのトピック名」または「イベント名」を短い名詞句で出力（例: "〇〇湯の新発売" 等）
`;
  } else {
    prompt = `
以下の日本語のニュース記事（漢方や生薬に関するもの）を読んで、要約と情報を抽出してください。
※本文全体の翻訳や出力は不要です。

【タイトル】
${title}

【本文】
${articleText}

以下の要件を満たす情報をJSONフォーマットで出力してください。
- summary: 記事の要約（3〜4文程度でわかりやすく。）。もし記事が「漢方薬・生薬・東洋医学・医療」と全く無関係な一般的なニュースである場合は \`UNRELATED\` とだけ出力し、もし詐欺サイト・SEOスパム・不審な通販やオークション相場情報である場合は \`SPAM\` とだけ出力してください。
- tags: 記事に関連する最も重要な漢方薬・生薬名、または企業名などのタグ（厳選して最大2つまで。例: 葛根湯, ツムラ 等）
- topic_name: この記事が扱っている主要な「ニュースのトピック名」または「イベント名」を短い名詞句で出力
- published_at: 記事本文内に公開日や発表日が記載されている場合、その日付を "YYYY-MM-DD" 形式で出力（不明な場合は空文字 "" にする）
`;
  }

  let maxRetries = FALLBACK_MODELS.length * 2;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const activeModel = getModel();
      const result = await activeModel.generateContent(prompt);
      return JSON.parse(result.response.text());
    } catch (error) {
      if (error.status === 429 || (error.message && error.message.includes('429'))) {
        console.log(`[429 Quota Exceeded] Model ${FALLBACK_MODELS[currentModelIndex]} hit rate limit. Switching model...`);
        currentModelIndex = (currentModelIndex + 1) % FALLBACK_MODELS.length;
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3秒待機して再試行
      } else {
        console.error('Gemini API Error:', error.message);
        throw error;
      }
    }
    attempts++;
  }
  throw new Error("All models exhausted or failed due to rate limits.");
}

// 全体のフロー: 取得 -> 未保存の記事を抽出 -> AI処理 -> DB保存
async function runUpdateJob() {
  if (isUpdating) {
    console.log('Update job is already running, skipping.');
    return 0;
  }
  
  isUpdating = true;
  console.log('Starting AI News update job...');
  let processedCount = 0;

  try {
    const items = await fetchAINews();

    // デモ・テスト用: 画面の「処理中」バナーを確認できるよう、少し待機
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 全17社のサイトをRSS経由で抽出してアイテムに追加
    const pharmaItems = await fetchPharmaSitesViaRSS();
    items.push(...pharmaItems);

    // 1ヶ月前（約30日前）の日付を計算
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const timeLimit = oneMonthAgo.getTime();

    // DBの既存タイトルを取得して、過去のジョブを含めた全体での重複を排除する
    const existingArticles = await Article.find({}, 'title').lean();
    const allExistingTitles = existingArticles.map(r => r.title);

    const uniqueItemsMap = new Map();
    for (const item of items) {
      // 過去1ヶ月以内の記事のみ追加
      if (!item.pubDate || new Date(item.pubDate).getTime() >= timeLimit) {
        if (!uniqueItemsMap.has(item.link)) {
          uniqueItemsMap.set(item.link, item);
        }
      } else {
        console.log(`Skipping old article (older than 1 month): ${item.title}`);
      }
    }
    const uniqueItems = Array.from(uniqueItemsMap.values());

    for (const item of uniqueItems) {
      // 既にデータベースに同じURLの記事があるかチェック
      const exists = await Article.findOne({ url: item.link }).lean();
      if (exists) {
        continue; // 既に保存済みならスキップ
      }

      console.log(`Processing: ${item.title}`);
      
      // 基本はRSSの情報をセット
      let contentToProcess = item.contentSnippet || item.content || item.title;
      
      // URLから実際の記事本文を抽出・Markdown化 (PDFの場合はスキップ)
      try {
        const finalUrl = item.link;
        if (finalUrl.toLowerCase().endsWith('.pdf')) {
          contentToProcess = '（PDF形式のニュースリリースです。詳細はリンク先をご参照ください）';
        } else {
          const response = await axios.get(finalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 10000
          });
          const html = response.data;

          const dom = new JSDOM(html, { url: finalUrl });
          const document = dom.window.document;
          
          // 画像とリンクの相対URLを絶対URLに変換
          document.querySelectorAll('img').forEach(img => {
            if (img.src) img.src = img.src;
          });
          document.querySelectorAll('a').forEach(a => {
            if (a.href) a.href = a.href;
          });

          const reader = new Readability(document);
          const article = reader.parse();
          if (article && article.content) {
            contentToProcess = turndownService.turndown(article.content);
          }
        }
      } catch (e) {
        console.warn(`Failed to scrape article content for ${item.link}:`, e.message);
      }
      
      // 本文が短すぎる、またはタイトルと同じ場合は保存をスキップする
      // ただし、category が 'news' の場合や、直接取得した製品情報(isDirectScrape=true)の場合は要約のみで強行突破する
      if (!item.isDirectScrape && item.category !== 'news' && (contentToProcess.length < 200 || contentToProcess === item.title || contentToProcess === item.contentSnippet)) {
        console.log(`Skipping: Article content is too short or missing. (${contentToProcess.length} chars)`);
        continue;
      }
      
      try {
        const apiResult = await processArticleWithGemini(contentToProcess, item.title, item.category);
        
        // Gemini APIの無料枠制限を確実に回避するため、1記事ごとに10秒待機する
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 無関係な記事（UNRELATED）やスパム（SPAM）はスキップ（ただし、製薬会社サイトからの直接取得分は除外しない）
        if (!item.isDirectScrape && apiResult && apiResult.summary && (apiResult.summary.includes('UNRELATED') || apiResult.summary.includes('SPAM'))) {
          console.log(`Skipping unrelated or spam article: ${item.title}`);
          continue;
        }

        if (apiResult) {
          let finalDate = new Date(item.pubDate || Date.now());
          if (apiResult.published_at && apiResult.published_at !== "") {
            const parsedDate = new Date(apiResult.published_at);
            if (!isNaN(parsedDate.getTime())) {
              finalDate = parsedDate;
            }
          }

          await Article.create({
            title: item.title,
            url: item.link,
            published_at: finalDate,
            original_content: contentToProcess,
            translated_title: item.title,
            summary: apiResult.summary || '',
            tags: JSON.stringify(apiResult.tags || []),
            translated_content: contentToProcess,
            topic_name: apiResult.topic_name || '一般ニュース',
            category: item.category || 'news'
          });
          processedCount++;
        }
      } catch (e) {
        // 既に存在するURLなどの場合はスキップ
        if (e.code !== 11000 && !e.message.includes('DEEPL_API_KEY')) {
          console.error('Database error:', e);
        }
      }
    }
  } catch (e) {
    console.error('Update job error:', e);
  } finally {
    isUpdating = false;
    lastUpdateCount = processedCount;
    console.log(`Update job finished. Added ${processedCount} new articles.`);
    
    // LINE Messaging API (公式アカウント) への通知送信
    if (processedCount > 0 && process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_USER_ID) {
      try {
        // RenderでのアプリURL（環境変数APP_URLで設定、なければRenderの自動URL）
        const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '';
        const messageText = `漢方ニュース: 新着が ${processedCount} 件ありました！\n\nここから確認してください👇\n${appUrl}`;
        
        await axios.post('https://api.line.me/v2/bot/message/push', {
          to: process.env.LINE_USER_ID,
          messages: [{
            type: 'text',
            text: messageText
          }]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          }
        });
        console.log('LINE Messaging API sent successfully.');
      } catch (lineErr) {
        console.error('LINE Messaging API failed:', lineErr.response ? lineErr.response.data : lineErr.message);
      }
    }
  }
  
  return processedCount;
}

function getStatus() {
  return { isUpdating, lastUpdateCount };
}

module.exports = {
  runUpdateJob,
  getStatus
};
