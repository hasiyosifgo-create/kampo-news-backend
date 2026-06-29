const db = require('better-sqlite3')('ainews.db');
const rows = db.prepare(`SELECT id, title, url, length(original_content) as content_length, topic_name FROM articles WHERE title LIKE '%必須漢方%' OR title LIKE '%産婦人科%' OR title LIKE '%女性特有%'`).all();
console.log(rows);
