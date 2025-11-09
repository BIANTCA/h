import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import * as ai from './function/ai.js';
import {
 saveIncomingFile
} from './saveIncomingFile.js';

// === CONFIG ===
const OWNER_JID = '628973229080@s.whatsapp.net';
const SELF_JID = '6285173278096@s.whatsapp.net';
const CHIKA_TOKEN_BOT = '8272480371:AAGweG5o3C2np0JEn-M-oMLLqewPqV_xdWw';
const VIDEO_TOKEN_BOT = '7886708843:AAEeJsq6wcUMur3hkF1s4PZcfa6-0JMkRcc';
const TG_CHAT_ID = 7890714374;
const INTRO_MSG = 'Hallo bang, saya tidak bisa memproses pesan karena saya bot, gunakan .menu untuk melihat fitur bot';
const MENU_MSG = 'Menu belom tersedia, saat ini fitur bot hanya menghapus semua pesan link pada group jika di jadikan admin';

// === STATE ===
const lastSent = new Map();
const recentLinkNotified = new Map();
const lastJoin = new Map();

// === UTILS ===
const now = (d = 0) => Date.now() + d * 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// === TELEGRAM CLIENT ===
class TelegramClient {
 constructor(chikaToken, videoToken, chatId) {
  this.chikaToken = chikaToken;
  this.videoToken = videoToken;
  this.chatId = chatId;
 }

 async downloadVideo(fileId) {
  try {
   const infoUrl = `https://api.telegram.org/bot${this.videoToken}/getFile?file_id=${fileId}`;
   const infoRes = await axios.get(infoUrl);
   if (!infoRes.data.ok) throw new Error(infoRes.data.description);

   const {
    file_path
   } = infoRes.data.result;
   const fileName = path.basename(file_path);
   const savePath = `./video/${fileName}`;

   fs.mkdirSync('./video', {
    recursive: true
   });

   const downloadUrl = `https://api.telegram.org/file/bot${this.videoToken}/${file_path}`;
   const videoRes = await axios.get(downloadUrl, {
    responseType: 'stream'
   });

   const writer = fs.createWriteStream(savePath);
   videoRes.data.pipe(writer);

   await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
   });

   return {
    ok: true,
    path: savePath
   };
  } catch (err) {
   console.error('❌ Gagal download video:', err.message);
   return {
    ok: false,
    error: err.message
   };
  }
 }

 async sendVideo(chatId, file, caption = '') {
  try {
   if (!file?.ok || !fs.existsSync(file.path)) throw new Error('File invalid');

   const form = new FormData();
   form.append('chat_id', chatId);
   form.append('video', fs.createReadStream(file.path));
   form.append('caption', caption || `📁 ${path.basename(file.path)}`);

   const res = await axios.post(`https://api.telegram.org/bot${this.chikaToken}/sendVideo`, form, {
    headers: form.getHeaders()
   });

   fs.unlinkSync(file.path);
   return res.data;
  } catch (err) {
   console.error('❌ Gagal kirim video:', err.message);
   return null;
  }
 }
}

// === FILE MANAGER ===
class FileManager {
 constructor(dir = './data') {
  this.dir = dir;
  fs.mkdirSync(dir, {
   recursive: true
  });
 }

 path(name) {
  return path.join(this.dir, name);
 }

 async readJSON(name, def = {}) {
  try {
   const data = await fs.promises.readFile(this.path(name), 'utf-8');
   return JSON.parse(data);
  } catch {
   await this.writeJSON(name, def);
   return def;
  }
 }

 async writeJSON(name, data) {
  await fs.promises.writeFile(this.path(name), JSON.stringify(data, null, 2));
 }
}

// === GROUP MANAGER ===
class GroupManager {
 constructor(sock) {
  this.sock = sock;
 }

async getMetadata(jid) {
  try {
   return await this.sock.groupMetadata(jid)
  } catch {
   return null
  }
 }

 async isAdmin(groupJid, userJid) {
  try {
   const meta = await this.getMetadata(groupJid)
   if (!meta?.participants) return false

   const participant = meta.participants.find(
    p => p.id === userJid || p.jid === userJid
   )

   return participant?.admin === 'admin' || participant?.admin === 'superadmin'
  } catch (err) {
   console.error('❌ isAdmin error:', err.message)
   return false
  }
 }
 
 async kick(groupJid, userJid) {
  try {
   await this.sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');
   return true;
  } catch {
   return false;
  }
 }

 async deleteMessage(jid, key) {
  try {
   await this.sock.sendMessage(jid, {
    delete: key
   }); return true
  } catch (err) {
   console.error('❌ Gagal hapus pesan:', err?.message ?? err); return false
  }
 }
}

// === WHATSAPP HELPER ===
class WhatsAppHelper {
 constructor(sock) {
  this.sock = sock;
 }

 async readMessage(m) {
  try {
   const senderJid = m.key.remoteJid ?? ''
   await this.sock.sendPresenceUpdate('available')
   await this.sock.readMessages([m.key])
   await this.sock.sendPresenceUpdate('composing', senderJid)
   await new Promise(r => setTimeout(r, 3000))
  } catch (err) {
   console.warn('readMessage error:', err?.message ?? err)
  }
 }

 async safeSend(jid, text, minInterval = 500) {
  if (!jid) return false;
  const last = lastSent.get(jid) || 0;
  if (Date.now() - last < minInterval) return false;
  try {
   await this.sock.sendMessage(jid, {
    text
   });
   lastSent.set(jid, Date.now());
   return true;
  } catch {
   return false;
  }
 }

 async sendVideo(jid, filePath, caption = '') {
  try {
   if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan');
   const buf = fs.readFileSync(filePath);
   await this.sock.sendMessage(jid, {
    video: buf, caption
   });
   fs.unlinkSync(filePath);
   return true;
  } catch {
   return false;
  }
 }

 async sendPhoto(jid, filePath, caption = '') {
  try {
   if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan');
   const buf = fs.readFileSync(filePath);
   await this.sock.sendMessage(jid, {
    image: buf, caption
   });
   fs.unlinkSync(filePath);
   return true;
  } catch {
   return false;
  }
 }

 async sendDocuments(jid, filePath, caption = '') {
  try {
   if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan');
   const buf = fs.readFileSync(filePath);
   const fileName = path.basename(filePath);
   await this.sock.sendMessage(jid, {
    document: buf,
    fileName,
    mimetype: 'application/octet-stream',
    caption: caption || `📄 ${fileName}`
   });
   return true;
  } catch {
   return false;
  }
 }
}

// === RANDOM VIDEO ===
async function getRandomVideoFromList(list, maxMB = 50) {
 const keys = Object.keys(list || {});
 if (!keys.length) return null;
 for (let i = 0; i < 10; i++) {
  const key = keys[Math.floor(Math.random() * keys.length)];
  const v = list[key];
  if (v && v.file_size <= maxMB * 1024 * 1024) return v;
 }
 return null;
}

// === LOOP VIDEO ===
async function loopVideo(sock, jid, tgClient, waHelper, tgVideoList, delayMin, caption) {
 while (true) {
  const vid = await getRandomVideoFromList(tgVideoList);
  if (!vid) break;
  const downloaded = await tgClient.downloadVideo(vid.file_id);
  if (!downloaded.ok) continue;
  await waHelper.sendVideo(jid, downloaded.path, `🎬 ${vid.file_name || caption}`);
  await sleep(1000 * 60 * delayMin);
 }
}

// === MESSAGE HANDLER ===
export async function handleMessage(sock, upsert) {
 const fm = new FileManager();
 const gm = new GroupManager(sock);
 const wa = new WhatsAppHelper(sock);
 const tg = new TelegramClient(CHIKA_TOKEN_BOT, VIDEO_TOKEN_BOT, TG_CHAT_ID);

 const m = upsert?.messages?.[0];
 if (!m || !m.message || m.key.fromMe) return;

 const text = (
  m.message.imageMessage?.caption ||
  m.message.videoMessage?.caption ||
  m.message.documentMessage?.caption ||
  m.message.extendedTextMessage?.text ||
  m.message.conversation ||
  ''
 ).trim();

 const quoted = m.message?.extendedTextMessage?.contextInfo ?? null
 const quotedJid = quoted?.participant || m.message?.imageMessage?.contextInfo?.participant || m.message?.videoMessage?.contextInfo?.participant || m.message?.documentMessage?.contextInfo?.participant || m.message?.audioMessage?.contextInfo?.participant || null
 const quotedText = quoted?.quotedMessage?.conversation ?? null
 const senderJid = m.key.remoteJid;
 const sender = (m.key.participant || senderJid).split('@')[0].replace(/\D/g, '');
 const isGroup = senderJid.endsWith('@g.us');
 const isOwner = ['628973229080',
  '219451605684246',
  '23653022474388'].includes(sender);
 const isAdmin = isGroup ? await gm.isAdmin(senderJid, SELF_JID): false;
 const isUserAdmin = isGroup ? await gm.isAdmin(senderJid, m.key.participant || senderJid): false;

 const cmdMatch = text.match(/^[.?!\/](\w+)(?:\s+(.*))?/i);
 const cmd = cmdMatch?.[1]?.toLowerCase();
 const params = cmdMatch?.[2]?.trim().split(/\s+/) || [];
 const allParams = text.split(cmd + ' ')[1] || '';

 const links = text.match(/https?:\/\/[^\s]+/g) || [];
 const isLink = links.length > 0;

 let config = await fm.readJSON('config.json', {});
 let linksList = await fm.readJSON('links.json', []);
 let videoList = await fm.readJSON('video.json', []);
 let tgVideoList = await fm.readJSON('tgVideo.json', {});

 if (senderJid === 'status@broadcast') return;

 if (isGroup) {
  const gc = config.group ||= {};
  if (!gc[senderJid]) {
   gc[senderJid] = {
    id: senderJid.split('@')[0].replace(/\D/g, ''),
    addTime: now(),
    totalMessage: 0,
    isPremium: false
   };
  }
  gc[senderJid].totalMessage++;
  await fm.writeJSON('config.json', config);
 }

 const typeMessage =
 m.message.conversation || m.message.extendedTextMessage ? 'text':
 m.message.imageMessage ? 'photo':
 m.message.videoMessage ? 'video':
 m.message.documentMessage ? 'file':
 m.message.audioMessage ? 'audio':
 m.message.stickerMessage ? 'sticker':
 m.message.contactMessage ? 'contact':
 m.message.locationMessage ? 'location':
 m.message.pollCreationMessage ? 'poll':
 m.message.buttonsMessage || m.message.listMessage ? 'interactive': 'unknown';

 console.log(`[${senderJid}] ${text || typeMessage}`);
 if (isLink && isAdmin) return gm.deleteMessage(senderJid, m.key)

 // === COMMAND HANDLER ===
 if (cmd) {
  if (!isGroup) await wa.readMessage(m);
  if (isAdmin && isOwner && isGroup) await gm.deleteMessage(senderJid, m.key);

  if (cmd === 'menu') await sock.sendMessage(senderJid, {
   text: MENU_MSG
  });
  if (cmd === 'pay') await wa.safeSend(senderJid, 'https://app.midtrans.com/payment-links/9761378475701\n\nBayar lewat link di atas...');
  if (cmd === 'docs' && isOwner) await wa.sendDocuments(senderJid, allParams);
  if (cmd === 'cekid') await wa.safeSend(senderJid, isGroup ? `Group ID: ${senderJid}\nYour ID: ${sender}`: senderJid);
  if (cmd === 'p') await wa.safeSend(senderJid, 'bot aktif');
  if (cmd === 'kick', isAdmin, isUserAdmin, quotedJid) gm.kick(senderJid, quotedJid)

  if (cmd === 'video' && isOwner) {
   const v = await getRandomVideoFromList(tgVideoList, 48);
   if (!v) return;
   const d = await tg.downloadVideo(v.file_id);
   if (d.ok) await wa.sendVideo(senderJid, d.path, `🎬 ${v.file_name || 'Video'}`);
  }

  if (cmd === 'loopfree' && isOwner) loopVideo(sock, senderJid, tg, wa, tgVideoList, 40, allParams);
  if (cmd === 'loopvideo' && isOwner) loopVideo(sock, senderJid, tg, wa, tgVideoList, 5, 'Video Premium');

  if (cmd === 'broadcast' && isOwner) {
   const groups = await sock.groupFetchAllParticipating();
   const ids = Object.keys(groups);
   for (const id of ids) {
    await sock.sendMessage(id, {
     text: allParams || '📢 Broadcast'
    });
    await sleep(1000);
   }
   await wa.safeSend(senderJid, '✅ Broadcast selesai');
  }
 }

 // === AUTO SAVE VIDEO ===
 if (typeMessage === 'video') {
  const saved = await saveIncomingFile(sock, m, './video');
  if (saved.ok) {
   const sent = await tg.sendVideo(TG_CHAT_ID, saved);
   if (sent?.result?.video?.file_id) {
    if (!videoList.includes(sent.result.video.file_id)) {
     videoList.push(sent.result.video.file_id);
     await fm.writeJSON('video.json', videoList);
    }
   }
  }
 }

 // === AUTO SAVE PHOTO (OWNER ONLY) ===
 if (!isGroup && !isOwner && typeMessage !== 'photo') return;
 if (isGroup) return;

 const saved = await saveIncomingFile(sock, m, './');
 if (saved.ok) {
  console.log('✅ File disimpan:', saved.path);
  if (!isOwner) await wa.sendPhoto(OWNER_JID, saved.path, senderJid);
  if (saved.path.endsWith('msg.js')) {
   await wa.safeSend(OWNER_JID, '📁 msg.js diterima. Restart bot untuk memuat perubahan.');
  }
 }
}