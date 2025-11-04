import axios from 'axios'
import fs from 'fs'
import path from 'path'
import FormData from 'form-data'
import * as ai from './function/ai.js'

import {
 saveIncomingFile
} from './saveIncomingFile.js'

// konstanta
const OWNER_JID = '628973229080@s.whatsapp.net'
const SELF_JID = '6285173278096@s.whatsapp.net'
const tgBotToken = '8272480371:AAGweG5o3C2np0JEn-M-oMLLqewPqV_xdWw'
const tgBotVideoToken = '7886708843:AAEeJsq6wcUMur3hkF1s4PZcfa6-0JMkRcc'
const tgChatId = 7890714374
const introMsg = 'Hallo bang, saya tidak bisa memproses pesan karena saya bot, gunakan .menu untuk melihat fitur bot'

// state global ringan
const lastSent = new Map()
const recentLinkNotified = new Map()
const lastJoin = new Map()

// -----------------------------
// TelegramClient: download / send video
// -----------------------------
class TelegramClient {
 constructor(botToken, videoToken, chatId) {
  this.botToken = botToken
  this.videoToken = videoToken
  this.chatId = chatId
 }

 async downloadVideo(fileId) {
  try {
   const infoUrl = `https://api.telegram.org/bot${this.videoToken}/getFile?file_id=${fileId}`
   const infoRes = await axios.get(infoUrl)
   if (!infoRes.data.ok) throw new Error(`Gagal ambil info file: ${infoRes.data.description}`)

   const fileInfo = infoRes.data.result
   const filePath = fileInfo.file_path
   const fileName = path.basename(filePath)
   const savePath = `./video/${fileName}`

   if (!fs.existsSync('./video')) fs.mkdirSync('./video', {
    recursive: true
   })

   const downloadUrl = `https://api.telegram.org/file/bot${this.videoToken}/${filePath}`
   const videoRes = await axios.get(downloadUrl, {
    responseType: 'stream'
   })

   const totalLength = parseInt(videoRes.headers['content-length'], 10) || 0
   let downloaded = 0
   const writer = fs.createWriteStream(savePath)

   console.log(`📥 Mengunduh: ${fileName}`)
   videoRes.data.on('data', (chunk) => {
    downloaded += chunk.length
    if (totalLength) {
     const percent = ((downloaded / totalLength) * 100).toFixed(2)
     process.stdout.write(`\rProgress: ${percent}%`)
    } else {
     process.stdout.write(`\rDownloaded: ${Math.round(downloaded / 1024)} KB`)
    }
   })

   await new Promise((resolve, reject) => {
    videoRes.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
   })

   console.log(`\n✅ Video berhasil diunduh: ${savePath}`)
   return {
    ok: true, info: fileInfo, path: savePath
   }
  } catch (err) {
   console.error('\n❌ Gagal mengunduh video:',
    err.message)
   return {
    ok: false, error: err.message
   }
  }
 }

 async sendVideo(chatId,
  file,
  caption = null) {
  try {
   if (!file?.ok || !file?.path) throw new Error('File tidak valid')
   if (!fs.existsSync(file.path)) throw new Error('File tidak ditemukan')

   const form = new FormData()
   form.append('chat_id', chatId)
   form.append('video', fs.createReadStream(file.path))
   const autoCaption = caption || '📁 ' + file.path.split('/').pop()
   form.append('caption', autoCaption)


   const res = await axios.post(`https://api.telegram.org/bot${this.botToken}/sendVideo`, form, {
    headers: form.getHeaders()
   })

   console.log('✅ Video terkirim ke Telegram:', res.data)
   try {
    fs.unlinkSync(file.path)
   } catch {}
   return res.data
  } catch (err) {
   console.error('❌ Gagal mengirim video ke Telegram:', err?.message ?? err)
   return null
  }
 }
}

// -----------------------------
// FileManager: helper baca/tulis file JSON
// -----------------------------
class FileManager {
 constructor(baseDir = './data') {
  this.baseDir = baseDir
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, {
   recursive: true
  })
 }

 filePath(fileName) {
  return path.join(this.baseDir, fileName)
 }

 async read(fileName) {
  const file = this.filePath(fileName)
  try {
   const data = await fs.promises.readFile(file, 'utf-8')
   return data.trim().length ? data: null
  } catch (err) {
   if (err.code === 'ENOENT') return null
   throw err
  }
 }

 async readJSON(fileName, defaultValue = {}) {
  const text = await this.read(fileName)
  if (!text) {
   await this.writeJSON(fileName, defaultValue); return defaultValue
  }
  try {
   const parsed = JSON.parse(text)
   if (typeof parsed !== 'object') throw new Error('Invalid JSON')
   return parsed
  } catch {
   await this.writeJSON(fileName, defaultValue)
   return defaultValue
  }
 }

 async write(fileName, content) {
  await fs.promises.writeFile(this.filePath(fileName), content, 'utf-8')
 }

 async writeJSON(fileName, data) {
  await this.write(fileName, JSON.stringify(data ?? {}, null, 2))
 }

 async delete(fileName) {
  const p = this.filePath(fileName)
  if (fs.existsSync(p)) await fs.promises.unlink(p)
 }
}

// -----------------------------
// GroupManager: wrapper operasi grup menggunakan sock
// -----------------------------
class GroupManager {
 constructor(sock) {
  this.sock = sock
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
   await this.sock.groupParticipantsUpdate(groupJid, [userJid], 'remove'); return true
  } catch (err) {
   console.error('❌ Gagal kick:', err?.message ?? err); return false
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

// -----------------------------
// WhatsAppHelper: safe send/join/read/sendVideo
// -----------------------------
class WhatsAppHelper {
 constructor(sock) {
  this.sock = sock
 }

 async safeSend(jid, text, minInterval = 3000) {
  if (!jid) return false
  const last = lastSent.get(jid) || 0
  if (Date.now() - last < minInterval) return false
  try {
   await this.sock.sendMessage(jid, {
    text: String(text)
   })
   lastSent.set(jid, Date.now())
   return true
  } catch (err) {
   console.error('safeSend error:', err?.message ?? err)
   return false
  }
 }

 async safeJoin(inviteCode, minInterval = 60 * 60 * 1000) {
  if (!inviteCode) return false
  const last = lastJoin.get(inviteCode) || 0
  if (Date.now() - last < minInterval) return false
  try {
   await this.sock.groupAcceptInvite(inviteCode)
   lastJoin.set(inviteCode, Date.now())
   return true
  } catch (err) {
   console.error('safeJoin error:', err?.message ?? err)
   return false
  }
 }

 async readMessage(m) {
  try {
   await this.sock.sendPresenceUpdate('available')
   await new Promise(r => setTimeout(r, 3000))
   await this.sock.readMessages([m.key])
   await this.sock.sendPresenceUpdate('unavailable')
  } catch (err) {
   console.warn('readMessage error:', err?.message ?? err)
  }
 }

 async sendVideo(jid, filePath, caption = '') {
  try {
   if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan')
   const fileName = path.basename(filePath)
   const buf = fs.readFileSync(filePath)
   await this.sock.sendMessage(jid, {
    video: buf, caption: caption || fileName
   })
   try {
    fs.unlinkSync(filePath)
   } catch {}
   console.log(`✅ Video terkirim ke ${jid} dan file dihapus: ${filePath}`)
   return true
  } catch (err) {
   console.error('❌ Gagal mengirim video:', err?.message ?? err); return false
  }
 }

 async sendDocuments(jid, filePath, caption = '') {
  try {
   if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan')
   const fileName = path.basename(filePath)
   const buf = fs.readFileSync(filePath)
   await this.sock.sendMessage(jid, {
    document: buf,
    fileName: fileName,
    mimetype: 'application/octet-stream',
    caption: caption || `📄 ${fileName}`
   })
   console.log(`✅ Dokumen terkirim ke ${jid} dan file dihapus: ${filePath}`)
   return true
  } catch (err) {
   console.error('❌ Gagal mengirim dokumen:', err?.message ?? err)
   return false
  }
 }
}

// -----------------------------
// util: now, sleep, getRandomVideo, loopVideo
// -----------------------------
function now() {
 return Date.now()
}
async function sleep(ms) {
 return new Promise(r => setTimeout(r, ms))
}

async function getRandomVideoFromList(tgVideoList, maxSizeMB = 50) {
 const vKeys = Object.keys(tgVideoList || {})
 if (!vKeys.length) return null
 for (let i = 0; i < 10; i++) {
  const rKey = vKeys[Math.floor(Math.random() * vKeys.length)]
  const data = tgVideoList[rKey]
  if (data && data.file_size <= maxSizeMB * 1024 * 1024) return data
 }
 return null
}

async function loopVideo(sock, senderJid, tgClient, waHelper, tgVideoList, delayMinutes, captionText) {
 while (true) {
  const rData = await getRandomVideoFromList(tgVideoList)
  if (!rData) {
   console.log('❌ Tidak ada video yang cocok.'); break
  }
  console.log('🎞️ Mengunduh video...')
  const rVideo = await tgClient.downloadVideo(rData.file_id)
  if (!rVideo.ok) {
   console.log('❌ Gagal download, lanjut ke video berikutnya...'); continue
  }
  console.log('📤 Mengirim video ke WA...')
  await waHelper.sendVideo(senderJid, rVideo.path, `🎬 ${rData.file_name || captionText}`)
  console.log(`⏳ Menunggu ${delayMinutes} menit sebelum kirim video berikutnya...`)
  await sleep(1000 * 60 * delayMinutes)
 }
}

// -----------------------------
// HANDLE MESSAGE (satu export)
// -----------------------------
export async function handleMessage(sock, upsert) {
 const fm = new FileManager('./data')
 const gm = new GroupManager(sock)
 const wa = new WhatsAppHelper(sock)

 const m = upsert?.messages?.[0]
 if (!m || !m.message || m.key?.fromMe) return

 const message = m.message
 const text = (
  message?.imageMessage?.caption ??
  message?.videoMessage?.caption ??
  message?.documentMessage?.caption ??
  message?.extendedTextMessage?.text ??
  message?.conversation ??
  '').trim()
 const senderJid = m.key.remoteJid ?? ''
 const sender = senderJid.split('@')[0].replace(/\D/g, '')
 const senderNumber = (m.key.participant ?? senderJid).split('@')[0].replace(/\D/g, '')
 const isGroup = senderJid.endsWith('@g.us')
 const isOwner = ['628973229080',
  '219451605684246',
  '23653022474388'].includes(senderNumber)
 const commandRegex = /^[.?!\/](\w+)(?:\s+(.*))?/i
 const match = commandRegex.exec((text ?? '').trim())
 const isCmd = !!match
 const cmd = isCmd ? match[1].toLowerCase(): null
 const params = isCmd && match[2] ? match[2].trim().split(/\s+/): []
 const allParams = isCmd ? text.split(cmd+' ')[1]: null
 const urlRegex = /(https?:\/\/[^\s]+)/g
 const links = (text.match(urlRegex) || [])
 const isLink = links.length > 0
 const tgClient = new TelegramClient(tgBotToken, tgBotVideoToken, tgChatId)
 const isAdmin = isGroup ? gm.isAdmin(senderJid, SELF_JID): null

 // baca file JSON yang diperlukan
 let config = await fm.readJSON('config.json', {})
 let linksList = await fm.readJSON('links.json', [])
 let videoList = await fm.readJSON('video.json', [])
 let tgVideoList = await fm.readJSON('tgVideo.json', {})

 if (senderJid === 'status@broadcast') return wa.readMessage(m)

 if (isGroup) {
  const gcCfgs = config.group ?? {}
  const gcList = Object.keys(gcCfgs)
  const gcId = senderJid.split('@')[0].replace(/\D/g, '')

  if (!gcList.includes(senderJid)) {
   gcCfgs[senderJid] = {
    id: gcId,
    addTime: now(),
    totalMessage: 1,
    isPremium: false
   }
   console.log(`📥 Grup baru terdeteksi & ditambahkan: ${senderJid}`)
  } else {
   gcCfgs[senderJid].totalMessage = (gcCfgs[senderJid].totalMessage ?? 0) + 1
  }

  config.group = gcCfgs
  await fm.writeJSON('config.json', config)
 }

 let typeMessage = 'unknown'

 if (message.conversation || message.extendedTextMessage) typeMessage = 'text'
 else if (message.imageMessage) typeMessage = 'photo'
 else if (message.videoMessage) typeMessage = 'video'
 else if (message.documentMessage) typeMessage = 'file'
 else if (message.audioMessage) typeMessage = 'audio'
 else if (message.stickerMessage) typeMessage = 'sticker'
 else if (message.contactMessage) typeMessage = 'contact'
 else if (message.locationMessage) typeMessage = 'location'
 else if (message.pollCreationMessage) typeMessage = 'poll'
 else if (message.buttonsMessage || message.listMessage) typeMessage = 'interactive'

 const notifyOwner = async (msg) => wa.safeSend(OWNER_JID, msg, 5000)
 const notifySelf = async (msg) => wa.safeSend(SELF_JID, msg, 3000)

 console.log(`[${senderJid}] ${text || typeMessage}`)

 const isMedia = ['video',
  'photo'].includes(typeMessage)

 ai.reply(text)
 if (text) {
  try {
   if (isLink) {
    const groupLinks = [...new Set(links.filter(l => l.includes('chat.whatsapp.com/')))]
    if (isAdmin && isGroup) await gm.deleteMessage(senderJid, m.key)
    if (!groupLinks.length) return
    if (now() - (recentLinkNotified.get(senderNumber) || 0) < 30_000) return
    recentLinkNotified.set(senderNumber, now())
    if (linksList.includes(links)) return
    linksList.push(links)
    await fm.writeJSON('links.json', linksList)
    await wa.safeSend(SELF_JID, `Link grup dari ${senderNumber} (${isGroup ? 'grup': 'chat pribadi'}):\n${groupLinks.slice(0, 10).map(l => `- ${l}`).join('\n')}`)
    return
   }

   // notifikasi ke owner untuk chat pribadi
   if (!isGroup) {
    await notifyOwner(`${senderJid}: ${text.length > 400 ? text.slice(0, 400) + '…': text}`)
    const users = Object.keys(config?.users ?? {})
    if (!users[senderNumber]) {
     config.users[senderNumber] = {
      totalMessage: 0,
      regDate: now(),
      isPremium: null
     }
     fm.writeJSON('config.json', config)
     sock.sendMessage(senderJid, {
      text: introMsg
     })
    } else {
     config.users[senderNumber].totalMessage += 1
     fm.writeJSON('config.json', config)
    }
    if (senderNumber === '628973229080') await wa.readMessage(m)
   }

   // command handling
   if (isCmd) {
    console.log(`${senderNumber}: ${cmd}`)

    if (cmd === 'pay') await wa.safeSend(senderJid, 'https://app.midtrans.com/payment-links/9761378475701\n\nBayar lewat link di atas, bisa lewat TF bang, QRIS dan lainnya, jika sudah bayar kirim bukti ke saya', 0)

    if (cmd === 'docs' && isOwner) await wa.sendDocuments(senderJid, allParams)
    if (cmd === 'cekid') await wa.safeSend(senderJid, isGroup ? `Group ID: ${senderJid.split('@')[0]}\nYour ID: ${senderNumber}`: senderJid.split('@')[0], 500)

    if (cmd === 'kick' && isOwner && isGroup) {
     const quoted = message?.extendedTextMessage?.contextInfo
     const targetJid = quoted?.participant || message?.imageMessage?.contextInfo?.participant || message?.videoMessage?.contextInfo?.participant || message?.documentMessage?.contextInfo?.participant || message?.audioMessage?.contextInfo?.participant || null
     if (!isAdmin) {
      console.log('❌ Saya bukan admin grup!'); return
     }
     if (!targetJid) {
      console.log('⚠️ Harus reply pesan anggota yang mau dikick.'); return
     }
     await gm.kick(senderJid, targetJid)
     console.log(`👢 Member ${targetJid} telah dikick oleh ${senderJid}`)
    }

    if (cmd === 'cekmsg' && isOwner) await wa.safeSend(OWNER_JID, JSON.stringify(message?.extendedTextMessage?.contextInfo ?? ['tidak ada'], null, 2))

    if (cmd === 'p') await wa.safeSend(senderJid, 'bot aktif')

    if (cmd === 'video' && isOwner) {
     const rData = await getRandomVideoFromList(tgVideoList, 48)
     if (!rData) return console.log('❌ Tidak ada video yang cocok.')
     const rVideo = await tgClient.downloadVideo(rData.file_id)
     if (!rVideo.ok) return console.log('❌ Gagal download video.')
     await wa.sendVideo(senderJid, rVideo.path, `🎬 ${rData.file_name || 'Video acak'}`)
    }

    if (cmd === 'loopfree' && isOwner) {
     loopVideo(sock, senderJid, tgClient, wa, tgVideoList, 70, 'Yang mau gabung VIP, 1 video per 5 menit, 10K, PC')
    }

    if (cmd === 'loopvideo' && isOwner) {
     loopVideo(sock, senderJid, tgClient, wa, tgVideoList, 5, 'Video Premium')
    }

    if (cmd === 'broadcast' && isOwner) {
     try {
      const groups = await sock.groupFetchAllParticipating()
      const groupIds = Object.keys(groups)
      if (!groupIds.length) {
       await wa.safeSend(senderJid, '❌ Tidak ada grup yang tergabung.'); return
      }
      const caption = allParams || '📢 Pesan broadcast tanpa teks.'
      await wa.safeSend(senderJid, `📡 Mengirim broadcast ke ${groupIds.length} grup...`)
      for (const id of groupIds) {
       await sock.sendMessage(id, {
        text: `${caption}`
       })
       console.log(`✅ Broadcast terkirim ke ${id}`)
       await sleep(1000)
      }
      await wa.safeSend(senderJid, '✅ Broadcast selesai dikirim ke semua grup.')
     } catch (err) {
      console.error('❌ Gagal mengirim broadcast:', err.message)
      await wa.safeSend(senderJid, '❌ Terjadi kesalahan saat broadcast.')
     }
    }
   }
  } catch (err) {
   console.error('message error:', err)
  }
  return
 }

 if (typeMessage === 'video') {
  try {
   if (message.videoMessage?.contextInfo?.statusSourceType === "VIDEO") return console.log('return statusSourceType')
   if (isLink) return console.log('Return contain link')
   const saved = await saveIncomingFile(sock, m, './video')
   if (saved.ok) {
    const data = await tgClient.sendVideo(tgChatId, saved)
    if (!data) return
    const fileId = data?.result?.video?.file_id ?? null
    if (!fileId) return
    if (videoList.includes(fileId)) return
    videoList.push(fileId)
    await fm.writeJSON('video.json', videoList)
   }
  } catch (err) {
   console.error('video error:' + err)
  }
 }

 try {
  if (!isOwner) return
  await wa.readMessage(m)
  const saved = await saveIncomingFile(sock, m, './')
  if (saved.ok) {
   console.log('✅ File disimpan:', saved.path, 'method:', saved.method)
   if (saved.path.endsWith('msg.js')) {
    await wa.safeSend(OWNER_JID, '📁 msg.js diterima dan disimpan di server. Silakan restart bot untuk memuat perubahan.')
   }
  } else {
   if (saved.reason && saved.reason !== 'no_supported_media') {
    console.error('❌ Gagal menyimpan file:', saved)
    await wa.safeSend(OWNER_JID, `❌ Gagal menyimpan file. Alasan: ${saved.reason} ${saved.error ? '| ' + saved.error: ''}`)
   }
  }
 } catch (err) {
  console.error('error saveIncomingFile:', err)
 }
}