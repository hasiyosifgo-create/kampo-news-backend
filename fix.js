require('dotenv').config();
const mongoose = require('mongoose');
const { Article } = require('./database');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  await Article.updateMany({ title: /ツムラ.*(純利益|増益|短信)/ }, { $set: { is_duplicate: true } });
  await Article.updateOne({ title: 'ツムラ、4-6月期(1Q)経常は58％増益で着地' }, { $set: { is_duplicate: false } });
  console.log('Fixed Tsumura duplicates');
  mongoose.disconnect();
}).catch(e => console.error(e));
