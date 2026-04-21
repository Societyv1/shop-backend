// server.js - SOCIETYXSHOP Backend
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');
const generatePayload = require('promptpay-qr');
const qrcode = require('qrcode');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();

// ==========================================
// 🚨🚨 1. เอา URL DISCORD WEBHOOK มาวางในเครื่องหมายคำพูดข้างล่างนี้ครับ 🚨🚨
// ==========================================
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1496014887032455188/QdbT0wpiTu5Wjgg59sptb9aTb4X3VioQUcOyaMxHfMvwZnAWwxLSwdv276AIRu8cMwSn";

// 🤖 ฟังก์ชันยิงแจ้งเตือนเข้า Discord
async function sendDiscordAlert(title, description, color) {
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) return;
  try {
    // ต้องใช้ fetch ใน Node.js (ถ้า Node เวอร์ชั่นใหม่ๆ จะมีมาให้เลย)
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{ title: title, description: description, color: color, timestamp: new Date().toISOString() }]
      })
    });
  } catch (err) { 
    console.log("ส่ง Discord ไม่สำเร็จ:", err.message); 
  }
}

// ===== MIDDLEWARE =====
// 👇 แก้ไขตรงนี้จุดเดียว เพื่อแก้บั๊ก Login / สินค้าไม่ขึ้น
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// 👆 
app.use(express.json());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ===== DATABASE =====
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/societyxshop', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// ===== SCHEMAS & MODELS =====
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false }, 
  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  name: String, description: String, category: String, price: Number, badge: String, image: String,
  soldCount: { type: Number, default: 0 } 
});

const refillSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  amount: Number,
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  slipImage: String,
  qrPayload: { type: String, default: null }, 
  date: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  productName: String, price: Number, licenseKey: { type: String, default: null },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const keySchema = new mongoose.Schema({
  productName: { type: String, default: 'CMD SOCIETY' },
  keyText: { type: String, required: true, unique: true },
  isUsed: { type: Boolean, default: false },
  usedBy: { type: String, default: null }
});

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Refill = mongoose.model('Refill', refillSchema);
const Order = mongoose.model('Order', orderSchema);
const Key = mongoose.model('Key', keySchema);

// ===== SEED KEYS =====
const initialKeys = [
  "Societyx-y5qwbL", "Societyx-mynlCs", "Societyx-LX7FQd", "Societyx-IUMSgm", "Societyx-L7iN1O",
  "Societyx-PcZ0EN", "Societyx-Cy61xR", "Societyx-88dICw", "Societyx-JH50EE", "Societyx-gMkmn0",
  "Societyx-m8FuLf", "Societyx-bZ5Tox", "Societyx-c1MdYO", "Societyx-ExhhuK", "Societyx-7CMC17",
  "Societyx-xqesNN", "Societyx-Au15EP", "Societyx-DZofUT", "Societyx-mci1Bz", "Societyx-86KjT0",
  "Societyx-JMKZUH", "Societyx-x5tXSa", "Societyx-FdssEx", "Societyx-edfA2P", "Societyx-tjIIRK",
  "Societyx-XZBIkK", "Societyx-1qmqfH", "Societyx-B6Nv77", "Societyx-sDimT2", "Societyx-SodEaz",
  "Societyx-rkkrID", "Societyx-vxLb4Y", "Societyx-PQks30", "Societyx-cK2Jqm", "Societyx-x5sBVR",
  "Societyx-756VXk", "Societyx-c30lGU", "Societyx-D8jXDC", "Societyx-kZdPwM", "Societyx-nuWJ6W",
  "Societyx-JHf7HD", "Societyx-x1nKW8", "Societyx-mnX1Ui", "Societyx-APOrSF", "Societyx-u1tkyL",
  "Societyx-82ygPU", "Societyx-UElYS2", "Societyx-K20ORz", "Societyx-48zFSg", "Societyx-8FQvRs",
  "Societyx-yoeJ68", "Societyx-a7GmFW", "Societyx-26kb61", "Societyx-g9sBSG", "Societyx-rJ9Eq9",
  "Societyx-YVwcUD", "Societyx-mYmxsi", "Societyx-gHT9Bd", "Societyx-TGyHFZ", "Societyx-6iEEMS",
  "Societyx-YWXgbU", "Societyx-t2dgFv", "Societyx-uHmm6m", "Societyx-qLeNKT", "Societyx-lubbBe",
  "Societyx-0Nr4wp", "Societyx-KHwbcL", "Societyx-wM4OgX", "Societyx-h7On2b", "Societyx-E2iCc2",
  "Societyx-BVMQ4G", "Societyx-1F1d8h", "Societyx-fPKZJu", "Societyx-eT9GKR", "Societyx-cl3zrk",
  "Societyx-Inh0kX", "Societyx-vcr3sD", "Societyx-tXBZUr", "Societyx-VtmL45", "Societyx-pGZpid",
  "Societyx-ztInds", "Societyx-JLynYC", "Societyx-Rr3iLN", "Societyx-DBDWZt", "Societyx-evCe2S",
  "Societyx-OUoRvh", "Societyx-kdG5Fb", "Societyx-uSu4WO", "Societyx-AaJC7N", "Societyx-XLI2Gh",
  "Societyx-92An7i", "Societyx-HjevJ0", "Societyx-QqcYVC", "Societyx-dnECbZ", "Societyx-55Ur5m",
  "Societyx-cBu94w", "Societyx-uHZTew"
];

async function seedDatabaseKeys() {
  const count = await Key.countDocuments();
  if (count === 0) {
    await Key.insertMany(initialKeys.map(k => ({ productName: 'CMD SOCIETY', keyText: k })));
    console.log(`✅ เสกคีย์ CMD จำนวน ${initialKeys.length} อัน เรียบร้อย!`);
  }
}
seedDatabaseKeys();

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'ไม่พบ token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.userId = decoded.id;
    next();
  } catch (err) { res.status(401).json({ message: 'Token ไม่ถูกต้อง' }); }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (user && user.isAdmin) {
      return next();
    }
    res.status(403).json({ message: 'สิทธิ์ไม่เพียงพอ สำหรับแอดมินเท่านั้น' });
  } catch (err) {
    res.status(500).json({ message: 'Error checking admin status' });
  }
};

// ==========================================
// 📧 ระบบส่งอีเมล (Nodemailer)
// ==========================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'guuter.11p@gmail.com', 
    pass: 'vwvaqhiwxcyqzhtp' 
  }
});

// ==========================================
// 🛡️ ระบบตรวจสอบสลิป AI (Production V7 - โหมดอ่านตัวเลขแม่นยำขั้นสุด)
// ==========================================
async function verifySlip(imageBuffer, expectedAmount) {
  try {
    console.log(`\n🔍 [1/2] ตรวจสลิปยอดเป้าหมาย: ${expectedAmount} บาท (โหมดตัวเลข)`);
    
    // 1. สแกน QR Code (บังคับต้องมี)
    const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const qrCode = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (!qrCode) return { success: false, message: '❌ ไม่พบ QR Code บนสลิป' };

    // 2. เคล็ดลับ: ขยายรูปให้ใหญ่ขึ้น 1200px และเร่ง Contrast ให้ตัวเลขสีดำเข้มจัดๆ
    const processedImageBuffer = await sharp(imageBuffer)
      .resize({ width: 1200 }) 
      .grayscale()
      .linear(1.5, -0.1) // เร่งความต่างสี
      .toBuffer();

    // 3. ⚡ ทีเด็ด: บังคับให้อ่านเฉพาะ 'eng' (ภาษาอังกฤษและตัวเลข) ตัดปัญหา AI สับสนสระภาษาไทย
    const result = await Tesseract.recognize(processedImageBuffer, 'eng');
    let text = result.data.text.replace(/\s+/g, '').toLowerCase();

    // 4. เช็คบัญชีร้านค้า: หาเลขท้าย 4 ตัว "8515" เท่านั้น
    if (!text.includes("8515")) {
       return { success: false, message: '❌ สลิปนี้ไม่ได้โอนเข้าบัญชีของร้านค้า (ไม่พบเลข 8515)' };
    }

    // 5. เช็คยอดเงิน: แปลงอักษรที่ AI มักจำผิดให้เป็นเลข
    let textForAmount = text.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/[lI|]/g, '1').replace(/,/g, '');
    
    // ดึงตัวเลขทุกชุดที่อยู่ในสลิปออกมา
    const matches = textForAmount.match(/\d+\.\d+|\d+/g) || [];
    
    // แปลงยอดที่ลูกค้ากรอก เป็นตัวเลขเพื่อเทียบ
    const targetAmount = parseFloat(expectedAmount);
    
    // ดูว่ามีตัวเลขชุดไหนตรงกับเป้าหมายไหม
    const isAmountMatch = matches.some(num => parseFloat(num) === targetAmount);

    if (isAmountMatch) {
      console.log(`✅ ผ่าน! พบยอดเงิน ${expectedAmount} และเลขบัญชี 8515`);
      return { success: true, payload: qrCode.data, amount: targetAmount };
    } else {
      console.log(`❌ AI หาเลขไม่เจอ (ตัวเลขที่ AI ดึงมาได้: ${matches.join(', ')})`);
      return { success: false, message: `สลิปถูกต้อง แต่ยอดเงินไม่ตรงเป้าหมาย (ระบบ AI หาเลข ${expectedAmount} ไม่เจอ)` };
    }

  } catch (err) {
    console.error("Slip Verification Error:", err);
    return { success: false, message: 'ระบบขัดข้อง โปรดลองใหม่อีกครั้ง' };
  }
}

}
// ===== ROUTES =====
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    // 📢 ยิงแจ้งเตือน Discord (สีเขียว)
    sendDiscordAlert("✨ สมาชิกใหม่เข้าร่วมร้าน!", `**Username:** ${username}\n**Email:** ${email}`, 3066993);

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user: newUser });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสมัครสมาชิก' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'ไม่พบอีเมลนี้ในระบบ' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = otp;
    user.resetCodeExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    const mailOptions = {
      from: '"SOCIETYxSHOP" <guuter.11p@gmail.com>', 
      to: user.email,
      subject: 'รหัสผ่านใหม่ (OTP) สำหรับ SOCIETYxSHOP',
      html: `
        <div style="font-family: sans-serif; background-color: #111; color: #fff; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #d4af37; text-align: center;">SOCIETYxSHOP</h2>
          <p>สวัสดีคุณ <b>${user.username}</b>,</p>
          <p>คุณได้ทำการขอรีเซ็ตรหัสผ่าน รหัส OTP 6 หลักของคุณคือ:</p>
          <div style="background-color: #222; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #d4af37; letter-spacing: 10px; margin: 0;">${otp}</h1>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'ส่งรหัส OTP ไปที่อีเมลแล้ว!' });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการส่งอีเมล' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email, resetCode: otp, resetCodeExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: 'รหัส OTP ไม่ถูกต้อง หรือหมดอายุแล้ว' });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetCode = null; 
    user.resetCodeExpires = null;
    await user.save();

    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบใหม่' });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน' }); }
});

app.get('/api/auth/profile', verifyToken, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json(user);
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().lean(); 
    const availableKeys = await Key.find({ isUsed: false });

    const productsWithStock = products.map(p => {
      if (p.name.toUpperCase().includes('CMD')) {
        const stockCount = availableKeys.filter(k => k.productName === p.name).length;
        return { ...p, stock: stockCount }; 
      }
      return { ...p, stock: 'unlimited' };
    });

    res.json(productsWithStock);
  } catch (err) { res.status(500).json({ message: 'Error loading products' }); }
});

app.post('/api/refill/generate-qr', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'ยอดเงินไม่ถูกต้อง' });
    const promptPayID = "0930078515"; 
    const payload = generatePayload(promptPayID, { amount: parseFloat(amount) });
    const qrImage = await qrcode.toDataURL(payload);
    res.json({ success: true, qrImage: qrImage, amount: amount });
  } catch (err) { res.status(500).json({ message: 'สร้าง QR Code ไม่สำเร็จ' }); }
});

app.post('/api/refill/verify', verifyToken, upload.single('slip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพ' });
    const expectedAmount = req.body.amount; 
    
    const slipResult = await verifySlip(req.file.buffer, expectedAmount);
    if (!slipResult.success) return res.status(400).json({ message: slipResult.message });

    const existingSlip = await Refill.findOne({ qrPayload: slipResult.payload, status: 'verified' });
    if (existingSlip) return res.status(400).json({ message: '❌ สลิปนี้ถูกใช้งานไปแล้ว!' });

    const amount = slipResult.amount; 
    const user = await User.findById(req.userId);
    user.balance += amount;
    await user.save();

    const refill = new Refill({ userId: req.userId, amount: amount, status: 'verified', qrPayload: slipResult.payload, slipImage: 'uploaded' });
    await refill.save();

    // 📢 ยิงแจ้งเตือน Discord (สีฟ้า)
    sendDiscordAlert("💰 มีการโอนเงินเข้าสู่ระบบ!", `**ผู้ใช้:** ${user.username}\n**ยอดเงิน:** ฿${amount.toFixed(2)}\n**ยอดเงินคงเหลือปัจจุบัน:** ฿${user.balance.toFixed(2)}`, 3447003);

    res.json({ success: true, newBalance: user.balance, message: `เติมเงินสำเร็จ! ยอด ${amount} บาท` });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเติมเงิน' }); }
});

app.get('/api/refill/history', verifyToken, async (req, res) => {
  res.json(await Refill.find({ userId: req.userId }).sort({ date: -1 }));
});

app.get('/api/orders', verifyToken, async (req, res) => {
  res.json(await Order.find({ userId: req.userId }).sort({ createdAt: -1 }));
});

app.post('/api/orders', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const { productId, productName, price } = req.body; 

    if (user.balance < price) return res.status(400).json({ message: 'ยอดเงินไม่พอ' });

    let assignedKey = null;
    if (productName.toUpperCase().includes('CMD')) {
      const keyRecord = await Key.findOneAndUpdate({ productName: productName, isUsed: false }, { isUsed: true, usedBy: user.username }, { new: true });
      if (!keyRecord) return res.status(400).json({ message: '❌ คีย์หมดสต๊อก!' });
      assignedKey = keyRecord.keyText;
    }

    user.balance -= price;
    await user.save();

    const order = new Order({ userId: user._id, productName, price, licenseKey: assignedKey, status: 'completed' });
    await order.save();

    if (productId) {
      await Product.findByIdAndUpdate(productId, { $inc: { soldCount: 1 } });
    }

    // 📢 ยิงแจ้งเตือน Discord (สีทอง/ส้ม)
    sendDiscordAlert("🛒 ออเดอร์ใหม่เข้าแล้ว!", `**ผู้ซื้อ:** ${user.username}\n**สินค้า:** ${productName}\n**ราคา:** ฿${price.toFixed(2)}`, 16766720);

    res.json({ message: 'สั่งซื้อสำเร็จ', newBalance: user.balance });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสั่งซื้อ' }); }
});

async function initializeData() {
  await Product.deleteMany({}); 
  await Product.insertMany([
    { name: 'Fast Loot', category: 'PUBG PC', price: 79, description: 'เก็บของไวใช้ได้กับหน้าจอ 1920x1080 กับ 1728x1080 เท่านั้น', badge: 'HOT', image: '/images/1.gif' , soldCount: 9 },
    { name: 'Macro External', category: 'PUBG PC', price: 149, description: 'ใช้งานผ่านเว็บไซต์ สามารถปรับความแรงในการดึงมาโครได้ตามอิสระ', badge: 'NEW', image: '/images/5.jpg', soldCount: 5 },
    { name: 'Macro LOGITECH ONLY', category: 'PUBG PC', price: 179, description: 'ใช้ได้เฉพาะเมาส์ LOGITECHเท่านั้น', badge: 'NEW', image: '/images/3.gif', soldCount: 14 },
    { name: 'Macro ALLMOUSE', category: 'PUBG PC', price: 199, description: 'สามารถใช้ได้กับเมาส์ทุกชนิด และมีตั้งค่าสำหรับDPI 400/800/1600', badge: 'HOT', image: '/images/2.gif', soldCount: 68 },
    { name: 'Special Pack', category: 'PUBG PC', price: 229, description: 'จะได้ตัวALLMOUSE พร้อมกับFAST LOOT คุ้มสุดๆ!!', badge: 'HOT', image: '/images/4.jpg', soldCount: 78 },
    { name: 'CMD SOCIETY', category: 'FIVEM', price: 29, description: 'ค่าขาว 100%', image: '/images/6.jpg', soldCount: 0 },
    { name: 'RESHADE SOCIETY', category: 'FIVEM', price: 20, description: 'มีReshadeมากกว่า 60+ PRESET', image: '/images/7.jpg', soldCount: 0 }
  ]);
  console.log('✅ รีเซ็ตและอัปเดตสินค้า (เพิ่มรูปภาพ) เรียบร้อยแล้ว!');
}

app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  const usersCount = await User.countDocuments();
  const orders = await Order.find().sort({ createdAt: -1 }).limit(10);
  const totalSales = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$price" } } }]);
  res.json({ usersCount, recentOrders: orders, totalSales: totalSales[0]?.total || 0 });
});

app.post('/api/admin/add-keys', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { productName, keysString } = req.body;
    const keysArray = keysString.split('\n').filter(k => k.trim() !== "");
    
    const keyDocs = keysArray.map(k => ({
      productName: productName,
      keyText: k.trim(),
      isUsed: false
    }));
    
    await Key.insertMany(keyDocs);
    res.json({ success: true, count: keysArray.length });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'มีคีย์นี้อยู่ในระบบแล้ว (ห้ามใส่คีย์ซ้ำ)' });
    }
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเพิ่มคีย์' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await initializeData();
});