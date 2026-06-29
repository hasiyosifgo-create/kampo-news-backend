const db = require('better-sqlite3')('ainews.db');
const rows = db.prepare("SELECT id, title, published_at FROM articles WHERE category = 'product'").all();

let updatedCount = 0;
for (const row of rows) {
  // Extract date like 2026.03.12 or 2025/12/12 from title
  const match = row.title.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    const newDateStr = `${year}-${month}-${day}T00:00:00.000Z`;
    db.prepare(`UPDATE articles SET published_at = ? WHERE id = ?`).run(newDateStr, row.id);
    console.log(`Updated ID ${row.id}: ${row.published_at} -> ${newDateStr}`);
    updatedCount++;
  }
}
console.log('Fixed', updatedCount, 'articles.');
