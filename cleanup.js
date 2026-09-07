require('dotenv').config();
const mongoose = require('mongoose');
const { Article } = require('./database');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const blogs = await Article.deleteMany({ category: 'blog' });
  console.log('Deleted blogs:', blogs.deletedCount);
  
  // Keep only the oldest Tsumura financial report to act as the primary, delete the rest
  const tsumuraReports = await Article.find({ topic_name: { $regex: '決算' }, tags: 'ツムラ' }).sort({ created_at: 1 });
  if (tsumuraReports.length > 1) {
    const idsToDelete = tsumuraReports.slice(1).map(r => r._id);
    const deleted = await Article.deleteMany({ _id: { $in: idsToDelete } });
    console.log('Deleted duplicate Tsumura reports:', deleted.deletedCount);
  }
  
  mongoose.disconnect();
}).catch(e => console.error(e));
