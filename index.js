// index.js
import makeWASocket, {
 useMultiFileAuthState,
 DisconnectReason,
 fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import pino from 'pino'
import {
 Boom
} from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import path from 'path'
import {
 fileURLToPath
} from 'url'

const USE_PAIRING_CODE = String(process.env.USE_PAIRING_CODE ?? '').toLowerCase() === 'false'
const PAIRING_PHONE = String(process.env.PAIRING_PHONE ?? '').trim()
const selfJid = String(process.env.selfJid ?? '6285173278096@s.whatsapp.net')
const ownerJid = '628973229080@s.whatsapp.net'


// setup __dirname untuk ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// dynamic import awal msg handler & saveIncomingFile
let {
 handleMessage
} = await import('./msg.js')
let {
 saveIncomingFile
} = await import('./saveIncomingFile.js')

// file watcher: reload saveIncomingFile.js and msg.js on change
const saveFilePath = path.join(__dirname, 'saveIncomingFile.js')
const msgFilePath = path.join(__dirname, 'msg.js')

fs.watchFile(saveFilePath, async () => {
 console.log('♻️  File saveIncomingFile.js berubah, memuat ulang...')
 try {
  const newSaveModule = await import(`./saveIncomingFile.js?update=${Date.now()}`)
  saveIncomingFile = newSaveModule.saveIncomingFile
  const newMsgModule = await import(`./msg.js?update=${Date.now()}`)
  handleMessage = newMsgModule.handleMessage
  console.log('✅ saveIncomingFile.js berhasil di-reload bersama msg.js')
 } catch (err) {
  console.error('❌ Gagal reload saveIncomingFile.js:', err)
 }
})

fs.watchFile(msgFilePath, async () => {
 console.log('♻️  File msg.js berubah, memuat ulang...')
 try {
  const newMsgModule = await import(`./msg.js?update=${Date.now()}`)
  handleMessage = newMsgModule.handleMessage
  console.log('✅ msg.js berhasil di-reload')
 } catch (err) {
  console.error('❌ Gagal reload msg.js:', err)
  sock.sendMessage(ownerJid, {text: `❌ Gagal reload msg.js: ${err}`})
 }
})

// helper kirim notifikasi aman ke owner
async function sendToSelf(sock, text) {
 try {
  if (!sock) return console.warn('sendToSelf: sock undefined')
  await sock.sendMessage(selfJid, {
   text: String(text)
  })
 } catch (err) {
  console.error('sendToSelf error:', err?.message ?? err)
 }
}

// start bot
async function startBot() {
 const {
  version,
  isLatest
 } = await fetchLatestBaileysVersion()
 console.log(`🔹 Menggunakan WhatsApp versi ${version.join('.')}, latest: ${isLatest}`)

 const {
  state,
  saveCreds
 } = await useMultiFileAuthState('./session')
 const sock = makeWASocket( {
  version,
  logger: pino( {
   level: 'info'
  }),
  auth: state,
  browser: ['MyBot', 'Chrome', '1.0.0']
 })
 console.log('DEBUG: USE_PAIRING_CODE =', USE_PAIRING_CODE, 'PAIRING_PHONE =', PAIRING_PHONE)
 console.log('DEBUG: typeof sock.requestPairingCode =', typeof sock.requestPairingCode)

 sock.ev.on('creds.update', saveCreds)
 sock.ev.on('group-participants.update', async (update) => {
  const {
   id, participants, action
  } = update
  // id = JID grup
  // participants = array berisi JID anggota
  // action = 'add', 'remove', atau 'promote'/'demote'

  for (const jid of participants) {
   if (action === 'add') {
    console.log(`👋 Member baru: ${jid} bergabung ke grup ${id}`)
   } else if (action === 'remove') {
    console.log(`👋 Member keluar: ${jid} dari grup ${id}`)
   }
  }
 })

 // pairing-code attempt (optional)
 if (USE_PAIRING_CODE && PAIRING_PHONE) {
  try {
   if (typeof sock.requestPairingCode === 'function') {
    console.log('🔹 Mencoba request pairing code ke WhatsApp...')
    try {
     const res = await sock.requestPairingCode(PAIRING_PHONE)
     console.log('Pairing code response:', res)
     await sendToSelf(sock, `Pairing code request berhasil.\nRespon: ${JSON.stringify(res, null, 1)}`)
    } catch (err) {
     console.warn('⚠️ Pairing-code gagal:', err?.message ?? err)
     await sendToSelf(sock, `⚠️ Pairing-code gagal: ${err?.message ?? err}. Fallback ke QR.`)
    }
   } else {
    console.log('ℹ️ requestPairingCode() tidak tersedia di instance sock — menggunakan QR.')
    await sendToSelf(sock, 'ℹ️ Pairing-code tidak didukung oleh build Baileys ini. Menggunakan QR.')
   }
  } catch (err) {
   console.warn('⚠️ Error saat mencoba pairing-code:', err?.message ?? err)
  }
 } else if (USE_PAIRING_CODE && !PAIRING_PHONE) {
  console.warn('⚠️ USE_PAIRING_CODE diaktifkan tetapi PAIRING_PHONE kosong. Lewati pairing-code.')
 }

 sock.ev.on('connection.update', (update) => {
  const {
   connection, lastDisconnect, qr
  } = update

  if (qr) {
   console.log('📱 Scan QR berikut untuk login WhatsApp:')
   qrcode.generate(qr, {
    small: true
   })
  }

  if (connection === 'close') {
   const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
   if (reason !== DisconnectReason.loggedOut) {
    console.log('🔄 Reconnecting...')
    startBot()
   } else {
    console.log('❌ Logout dari WhatsApp')
   }
  } else if (connection === 'open') {
   console.log('✅ Bot WhatsApp berhasil tersambung!')
  }
 })
 // messages.upsert -> delegate to msg.js handler
 let isFirstSync = true

 // event listener utama
 sock.ev.on('messages.upsert',
  async ({
   messages
  }) => {
   if (isFirstSync) {
    console.log('⚠️ Mengabaikan semua pesan backlog saat reconnect.')
    isFirstSync = false
    return
   }
   const m = messages[0]
   if (!m?.message) return
   await handleMessage(sock, {
    messages
   })
  })
 return sock
}

// jalankan bot
startBot().catch((err) => {
 console.error('Fatal error startBot:', err)
})