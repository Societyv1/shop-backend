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

const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1496014887032455188/QdbT0wpiTu5Wjgg59sptb9aTb4X3VioQUcOyaMxHfMvwZnAWwxLSwdv276AIRu8cMwSn";

async function sendDiscordAlert(title, description, color) {
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) return;
  try {
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

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/societyxshop', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  tag: { type: String, default: null },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false }, 
  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// 🔥 อัปเดต Schema ให้รองรับสินค้าจาก 499K
const productSchema = new mongoose.Schema({
  name: String, description: String, category: String, price: Number, badge: String, image: String,
  soldCount: { type: Number, default: 0 },
  is499k: { type: Boolean, default: false }, // เช็คว่าเป็นของ 499K ไหม
  apiProductId: { type: String, default: null }, // ID จาก 499K
  apiStock: { type: Number, default: 0 } // จำนวนสต็อกที่เหลือใน 499K
});

const refillSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  amount: Number,
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  slipImage: String,
  qrPayload: { type: String, default: null }, 
  date: { type: Date, default: Date.now }
});

const promoCodeSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  bonusAmount: { type: Number, required: true },
  maxUses: { type: Number, default: 100 },
  usedCount: { type: Number, default: 0 },
  usedByUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  expiresAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
});

const announcementSchema = new mongoose.Schema({
  message: { type: String, required: true },
  type: { type: String, default: 'info' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
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
const PromoCode = mongoose.model('PromoCode', promoCodeSchema);
const Announcement = mongoose.model('Announcement', announcementSchema);
const Order = mongoose.model('Order', orderSchema);
const Key = mongoose.model('Key', keySchema);

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

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'guuter.11p@gmail.com', 
    pass: 'vwvaqhiwxcyqzhtp' 
  }
});

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

async function verifySlip(imageBuffer, expectedAmount) {
  try {
    const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const qrCode = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (!qrCode) return { success: false, message: '❌ ไม่พบ QR Code บนสลิป' };

    const processedImageBuffer = await sharp(imageBuffer)
      .resize({ width: 1000 }) 
      .grayscale()
      .toBuffer();

    const result = await Tesseract.recognize(processedImageBuffer, 'tha+eng');
    let text = result.data.text.replace(/\s+/g, '').toLowerCase();

    const isMySlip = text.includes("8515") || text.includes("อภิวรรธน์") || text.includes("ภู่ถาวร");
    if (!isMySlip) {
       return { success: false, message: '❌ สลิปนี้ไม่ได้โอนเข้าบัญชีของร้านค้า' };
    }

    let textForAmount = text.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/[lI|]/g, '1').replace(/,/g, '');
    const matches = textForAmount.match(/\d+\.\d+|\d+/g) || [];
    
    const targetAmount = parseFloat(expectedAmount);
    const isAmountMatch = matches.some(num => parseFloat(num) === targetAmount);

    if (isAmountMatch) {
      return { success: true, payload: qrCode.data, amount: targetAmount };
    } else {
      return { success: false, message: `สลิปถูกต้อง แต่ยอดเงินไม่ตรงเป้าหมาย (${expectedAmount} บาท)` };
    }
  } catch (err) {
    return { success: false, message: 'ระบบขัดข้อง โปรดลองใหม่อีกครั้ง' };
  }
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const tag = Math.floor(1000 + Math.random() * 9000).toString();
    const newUser = new User({ username, tag, email, password: hashedPassword });
    await newUser.save();

    sendDiscordAlert("✨ สมาชิกใหม่เข้าร่วมร้าน!", `**Username:** ${username}#${tag}\n**Email:** ${email}`, 3066993);

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user: newUser });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสมัครสมาชิก (อาจมีชื่อซ้ำ)' }); }
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
  const user = await User.findById(req.userId).select('-password');
  res.json(user);
});

// 🔥 อัปเดตให้รองรับสต็อกของ 499K ด้วย
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().lean(); 
    const availableKeys = await Key.find({ isUsed: false });

    const productsWithStock = products.map(p => {
      if (p.name.toUpperCase().includes('CMD')) {
        const stockCount = availableKeys.filter(k => k.productName === p.name).length;
        return { ...p, stock: stockCount }; 
      }
      if (p.is499k) {
        return { ...p, stock: p.apiStock }; // แสดงสต็อกตรงๆ จาก 499K
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

    sendDiscordAlert("💰 มีการโอนเงินเข้าสู่ระบบ!", `**ผู้ใช้:** ${user.username}#${user.tag || '0000'}\n**ยอดเงิน:** ฿${amount.toFixed(2)}\n**ยอดเงินคงเหลือปัจจุบัน:** ฿${user.balance.toFixed(2)}`, 3447003);

    res.json({ success: true, newBalance: user.balance, message: `เติมเงินสำเร็จ! ยอด ${amount} บาท` });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเติมเงิน' }); }
});

app.get('/api/refill/history', verifyToken, async (req, res) => {
  res.json(await Refill.find({ userId: req.userId }).sort({ date: -1 }));
});

app.post('/api/refill/redeem-code', verifyToken, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'กรุณากรอกโค้ดส่วนลด' });

    const promo = await PromoCode.findOne({ code: code.trim().toUpperCase(), isActive: true });
    if (!promo) return res.status(400).json({ message: '❌ โค้ดนี้ไม่ถูกต้อง หรือหมดอายุแล้ว' });

    if (promo.expiresAt && new Date() > new Date(promo.expiresAt)) {
      return res.status(400).json({ message: '❌ โค้ดนี้หมดเขตใช้งานแล้ว' });
    }

    if (promo.usedByUsers.includes(req.userId)) {
      return res.status(400).json({ message: '❌ คุณได้ใช้โค้ดนี้ไปแล้ว ไม่สามารถใช้ซ้ำได้อีก' });
    }

    if (promo.usedCount >= promo.maxUses) {
      return res.status(400).json({ message: '❌ โค้ดนี้ถูกใช้งานครบจำนวนจำกัดแล้ว' });
    }

    const user = await User.findById(req.userId);
    user.balance += promo.bonusAmount;
    
    promo.usedByUsers.push(user._id);
    promo.usedCount += 1;

    await promo.save();
    await user.save();

    sendDiscordAlert("🎟️ มีการใช้โค้ดเติมเงิน!", `**ผู้ใช้:** ${user.username}#${user.tag || '0000'}\n**โค้ด:** \`${promo.code}\`\n**ได้รับโบนัสเพิ่ม:** ฿${promo.bonusAmount}\n**ยอดเงินปัจจุบัน:** ฿${user.balance.toFixed(2)}`, 65280);

    res.json({ success: true, newBalance: user.balance, bonus: promo.bonusAmount, message: `✓ ใช้โค้ดสำเร็จ! รับเงินโบนัสเพิ่ม ฿${promo.bonusAmount}` });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการใช้โค้ด' });
  }
});

app.post('/api/admin/promo-codes', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { code, bonusAmount, maxUses, expiresAt } = req.body;
    const newPromo = new PromoCode({
      code: code.trim().toUpperCase(),
      bonusAmount: parseFloat(bonusAmount),
      maxUses: maxUses ? parseInt(maxUses) : 100,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });
    await newPromo.save();
    res.json({ success: true, message: `สร้างโค้ด ${newPromo.code} (โบนัส ฿${newPromo.bonusAmount}) สำเร็จ!` });
  } catch (err) {
    res.status(500).json({ message: 'โค้ดนี้มีอยู่ในระบบแล้ว หรือเกิดข้อผิดพลาด' });
  }
});

app.get('/api/announcements', async (req, res) => {
  try {
    const activeAnnouncements = await Announcement.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(activeAnnouncements);
  } catch (err) {
    res.status(500).json({ message: 'Error loading announcements' });
  }
});

app.post('/api/admin/announcements', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { message, type } = req.body;
    const newAnnounce = new Announcement({ message, type });
    await newAnnounce.save();
    res.json({ success: true, message: 'สร้างประกาศสำเร็จ!' });
  } catch (err) {
    res.status(500).json({ message: 'Error creating announcement' });
  }
});

app.delete('/api/admin/announcements/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'ลบประกาศสำเร็จ!' });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบประกาศ' });
  }
});

app.get('/api/user/promo-history', verifyToken, async (req, res) => {
  try {
    const usedPromos = await PromoCode.find({ usedByUsers: req.userId }).select('code bonusAmount expiresAt');
    res.json(usedPromos);
  } catch (err) {
    res.status(500).json({ message: 'Error loading promo history' });
  }
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

    let updatedProduct = null;
    if (productId) {
      updatedProduct = await Product.findByIdAndUpdate(
        productId, 
        { $inc: { soldCount: 1 } },
        { new: true }
      );
    } else if (productName) {
      updatedProduct = await Product.findOneAndUpdate(
        { name: productName }, 
        { $inc: { soldCount: 1 } },
        { new: true }
      );
    }

    if (updatedProduct) {
      const buyerName = user.username.length > 4 
        ? user.username.substring(0, 2) + '****' + user.username.slice(-2)
        : user.username.substring(0, 1) + '***';

      io.emit('productSold', {
        productId: updatedProduct._id,
        productName: updatedProduct.name,
        newSoldCount: updatedProduct.soldCount,
        productImage: updatedProduct.image, 
        buyerName: buyerName,               
        time: new Date().toLocaleString('th-TH') 
      });
    }

    let discordMsg = `**รหัสคำสั่งซื้อ:** \`#${order._id}\`\n**ผู้ซื้อ:** ${user.username}#${user.tag || '0000'}\n**สินค้า:** ${productName}\n**ราคา:** ฿${price.toFixed(2)}`;
    if (assignedKey) {
      discordMsg += `\n**License Key:** \`${assignedKey}\``;
    }
    sendDiscordAlert("🛒 ออเดอร์ใหม่เข้าแล้ว!", discordMsg, 16766720);

    res.json({ message: 'สั่งซื้อสำเร็จ', orderId: order._id, licenseKey: assignedKey, newBalance: user.balance });
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสั่งซื้อ' }); }
});

app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  const usersCount = await User.countDocuments();
  const orders = await Order.find().sort({ createdAt: -1 }).limit(10);
  const totalSales = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$price" } } }]);
  res.json({ usersCount, recentOrders: orders, totalSales: totalSales[0]?.total || 0 });
});

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้' });
  }
});

app.post('/api/admin/users/balance', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { userId, amount, action } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'ไม่พบผู้ใช้' });

    const numAmount = parseFloat(amount);
    if (action === 'add') {
      user.balance += numAmount;
    } else if (action === 'subtract') {
      user.balance = Math.max(0, user.balance - numAmount);
    }
    
    await user.save();
    res.json({ success: true, message: `อัปเดตยอดเงินให้ ${user.username}#${user.tag} เป็น ฿${user.balance} สำเร็จ!` });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัปเดตยอดเงิน' });
  }
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

// ==========================================
// 🎮 ระบบเชื่อมต่อและซิงค์ API 499K Network (อัปเดตดึงข้อมูลเข้า DB)
// ==========================================
app.post('/api/admin/sync-499k', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const response = await fetch('https://store.499k-network.com/api/v1/products?expand=steam', { 
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_499K_KEY}` 
      }
    });

    const data = await response.json();
    
    if (!response.ok || !data.success) {
      return res.status(400).json({ success: false, message: '499K ฟ้องว่ามี Error', details: data });
    }

    // เซฟตี้ดักแครช: เผื่อ 499K ส่งข้อมูลมาแปลกๆ หรือไม่มี products
    if (!data.data || !Array.isArray(data.data.products)) {
      return res.status(400).json({ success: false, message: 'ข้อมูลจาก 499K ผิดรูปแบบ ไม่พบรายการสินค้า' });
    }

    let addedCount = 0;
    let updatedCount = 0;

    // ลูปดึงของจาก 499K ทีละชิ้นมาลงร้านเรา
    for (const p of data.data.products) {
      // เซฟตี้: จัดการราคาเผื่อได้ค่าเป็น Null
      const rawPrice = parseFloat(p.price) || 0;
      const myPrice = Math.ceil(rawPrice * 1.3) || 99; // บวกกำไร 30%

      // หาว่าเคยมีสินค้านี้ในร้านเราหรือยัง
      const existingProduct = await Product.findOne({ apiProductId: String(p.product_id) });

      if (existingProduct) {
        // อัปเดตของที่มีอยู่แล้ว
        existingProduct.price = myPrice;
        existingProduct.image = p.image || '/images/5.jpg';
        existingProduct.apiStock = parseInt(p.stock) || 0;
        await existingProduct.save();
        updatedCount++;
      } else {
        // เซฟตี้: จัดการ Description และหมวดหมู่
        let desc = 'เกม PC แท้ (Offline)';
        if (p.steam && Array.isArray(p.steam.genres)) {
          desc = p.steam.genres.join(', ');
        }
        let cat = p.platform || 'API Game';
        if (cat.toLowerCase() === 'steam') cat = 'Steam Game';

        // สร้างสินค้าใหม่
        const newProduct = new Product({
          name: p.name || 'ไม่มีชื่อสินค้า',
          description: desc,
          category: cat,
          price: myPrice,
          badge: 'API 499K',
          image: p.image || '/images/5.jpg',
          is499k: true,
          apiProductId: String(p.product_id),
          apiStock: parseInt(p.stock) || 0
        });
        await newProduct.save();
        addedCount++;
      }
    }

    res.json({ success: true, message: `ดึงของสำเร็จ! เพิ่มใหม่ ${addedCount} รายการ, อัปเดต ${updatedCount} รายการ` });

  } catch (err) {
    console.error("499K Sync Error:", err);
    // ส่ง err.message กลับไปโชว์ที่ Alert ให้แอดมินรู้ชัดๆ ว่าพังบรรทัดไหน
    res.status(500).json({ success: false, message: `ระบบพัง: ${err.message}` });
  }
});

async function initializeData() {
  const count = await Product.countDocuments();
  if (count === 0) {
    await Product.insertMany([
      { name: 'Fast Loot', category: 'PUBG PC', price: 79, description: 'เก็บของไวใช้ได้กับหน้าจอ 1920x1080 กับ 1728x1080 เท่านั้น', badge: 'HOT', image: '/images/1.gif' , soldCount: 11 },
      { name: 'Macro External', category: 'PUBG PC', price: 149, description: 'ใช้งานผ่านเว็บไซต์ สามารถปรับความแรงในการดึงมาโครได้ตามอิสระ', badge: 'NEW', image: '/images/4.jpg', soldCount: 5 },
      { name: 'Macro ALLMOUSE', category: 'PUBG PC', price: 199, description: 'สามารถใช้ได้กับเมาส์ทุกชนิด และมีตั้งค่าสำหรับDPI 400/800/1600', badge: 'HOT', image: '/images/2.gif', soldCount: 74 },
      { name: 'Special Pack', category: 'PUBG PC', price: 229, description: 'จะได้ตัวALLMOUSE พร้อมกับFAST LOOT คุ้มสุดๆ!!', badge: 'HOT', image: '/images/3.jpg', soldCount: 78 },
      { name: 'CMD SOCIETY', category: 'FIVEM', price: 29, description: 'ค่าขาว 100%', image: '/images/5.jpg', soldCount: 11 },
      { name: 'RESHADE&ROAD SOCIETY', category: 'FIVEM', price: 20, description: 'มีReshadeมากกว่า 200+ PRESET', image: '/images/6.jpg', soldCount: 1 },
      { name: 'SYSTEM TUNING PERFORMANCE', category: 'FIVEM', price: 5, description: 'ช่วยปรับค่าเน็ต และปรับค่าต่างๆในวินโด้ให้มีประสิทธิภาพมากขึ้น', badge: 'NEW', image: '/images/7.jpg', soldCount: 7 },
      { name: 'SOCIETYXSHOP - PC Optimizer (จูนคอมลดดีเลย์)', category: 'FIVEM', price: 15, description: 'ปลดล็อกขีดจำกัด PC ดัน FPS ลดปิง แก้เมาส์หน่วง... จบในคลิกเดียว! ค่าร้านดัง', image: '/images/9.jpg', soldCount: 8 },
      { name: 'SOCIETYXSHOP - สั่งคลิ', category: 'FIVEM', price: 45, description: 'สั่งคลิลั่นๆ แต่ไม่คลิมั่วเนียนๆ เอาไว้เล่นเดิมพันสบาย', badge: 'NEW', image: '/images/8.jpg', soldCount: 2 },
      { name: 'Macro FreeFire', category: 'FreeFire', price: 59, description: 'ลากหัวลั่นๆ ร้านแรกในไทยที่นำมาขาย', badge: 'NEW', image: '/images/10.jpg', soldCount: 1 }
    ]);
    console.log('✅ เพิ่มสินค้าเริ่มต้นเรียบร้อยแล้ว!');
  } else {
    console.log(`✅ พบสินค้าในระบบ ${count} รายการ (ไม่ต้องรีเซ็ตยอดขาย)`);
  }
}

async function migrateUserTags() {
  try {
    const usersWithoutTag = await User.find({ tag: null });
    if (usersWithoutTag.length > 0) {
      for (let user of usersWithoutTag) {
        user.tag = Math.floor(1000 + Math.random() * 9000).toString();
        await user.save();
      }
      console.log(`✅ [Migration] สุ่มเสก Tag ให้ลูกค้าเก่าจำนวน ${usersWithoutTag.length} คนเรียบร้อยแล้ว!`);
    }
  } catch(err) { 
    console.log('❌ เกิดข้อผิดพลาดตอนอัปเดตแท็กลูกค้าเก่า', err); 
  }
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeData();
  await migrateUserTags(); 
});