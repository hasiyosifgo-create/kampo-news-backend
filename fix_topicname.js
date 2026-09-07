require('dotenv').config();
const mongoose = require('mongoose');
const { Article } = require('./database');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const result = await Article.updateMany(
    { topic_name: '一般ニュース' },
    { $set: { topic_name: '' } }
  );
  console.log('Updated:', result.modifiedCount, 'articles');
  mongoose.disconnect();
}).catch(e => console.error(e));
