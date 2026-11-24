import fs from 'fs';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

// Jeda 1.5 detik biar terkesan manusiawi lagi ngetik
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DB_FILE = './database.json';

// Kata kunci spam jualan/link saingan di grup
const SPAM_KEYWORDS = [
    'jual wdp', 'topup murah', 'dm murah', 'diamond murah', 
    'chip higgs', 'open jasa', 'ready akun', 'sewa bot', 
    'join grup', 'klik link', 'chat.whatsapp.com', 't.me/', 'wa.me/'
];

// --- HELPER BACA & SIMPAN DATABASE ---
function getDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const defaultDb = { products: [], customCommands: {}, settings: {} };
            fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
            return defaultDb;
        }
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(data || '{}');
        if (!parsed.customCommands) parsed.customCommands = {};
        if (!parsed.products) parsed.products = [];
        if (!parsed.settings) parsed.settings = {};
        return parsed;
    } catch (e) {
        return { products: [], customCommands: {}, settings: {} };
    }
}

function saveDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Anti-duplikat pesan
const processedMessages = new Set();

// --- HANDLER UTAMA ---
export async function handleMessages(sock, chatUpdate) {
    const messageInfo = chatUpdate.messages?.[0];
    if (!messageInfo || !messageInfo.message) return;

    const remoteJid = messageInfo.key.remoteJid;
    if (remoteJid === 'status@broadcast') return;
    if (messageInfo.key.fromMe) return;

    const messageId = messageInfo.key.id;
    if (processedMessages.has(messageId)) return;
    processedMessages.add(messageId);
    setTimeout(() => processedMessages.delete(messageId), 30000);

    const isGroup = remoteJid.endsWith('@g.us');
    const sender = isGroup ? (messageInfo.key.participant || messageInfo.participant) : remoteJid;

    // Ekstraksi teks pesan
    const messageContent = messageInfo.message;
    const rawText = 
        messageContent.conversation || 
        messageContent.extendedTextMessage?.text || 
        messageContent.imageMessage?.caption || 
        '';

    const trimmedText = rawText.trim();
    if (!trimmedText) return;

    const fullTextLower = trimmedText.toLowerCase();
    const cleanWord = trimmedText.replace(/[!?.,]/g, '').trim().toLowerCase();

    // -------------------------------------------------------------------------
    // 🛡️ 1. KEAMANAN & ANTI-SPAM DI DALAM GRUP
    // -------------------------------------------------------------------------
    let isSenderAdmin = false;
    let isBotAdmin = false;

    if (isGroup) {
        try {
            const groupMeta = await sock.groupMetadata(remoteJid);
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            const botParticipant = groupMeta.participants.find(p => p.id === botNumber);
            isBotAdmin = botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');

            const senderParticipant = groupMeta.participants.find(p => p.id === sender);
            isSenderAdmin = senderParticipant && (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin');

            // Jika ada orang asing nyepam jualan di grup, langsung sikat kick & HAPUS PESANNYA UNTUK SEMUA ORANG!
            if (!isSenderAdmin && isBotAdmin) {
                const isSpam = SPAM_KEYWORDS.some(keyword => fullTextLower.includes(keyword));
                if (isSpam) {
                    console.log(`[SPAM TERDETEKSI] Menghapus pesan dan mengeluarkan spammer: ${sender}`);

                    // 1. HAPUS PESAN SPAM UNTUK SEMUA ORANG (Delete for Everyone)
                    try {
                        await sock.sendMessage(remoteJid, {
                            delete: {
                                remoteJid: remoteJid,
                                fromMe: false,
                                id: messageInfo.key.id,
                                participant: sender
                            }
                        });
                    } catch (e) {
                        console.error('Gagal hapus pesan spam:', e);
                    }

                    // 2. KICK SPAMMER KELUAR DARI GRUP
                    try {
                        await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
                    } catch (e) {
                        console.error('Gagal kick spammer:', e);
                    }

                    // 3. Notifikasi pemberitahuan di grup
                    return await sock.sendMessage(remoteJid, {
                        text: `⚠️ *ANTI-SPAM AKTIF!*\n\nPesan spam dari @${sender.split('@')[0]} telah dihapus untuk semua orang dan nomornya otomatis dikeluarkan dari grup!`,
                        mentions: [sender]
                    });
                }
            }
        } catch (err) {}
    }

    // Di grup: Kalau bukan admin, bot ga usah dengerin suruhan (biar ga rusuh)
    if (isGroup && !isSenderAdmin) {
        return;
    }

    const db = getDb();

    // =========================================================================
    // 🗣️ SEMUA PERINTAH ADMIN SEKARANG BISA PAKE BAHASA SEHARI-HARI!
    // =========================================================================

    // 1. GANTI HARGA (Contoh: "tolong ganti harga wdp jadi 25k 1 pcs nya dong")
    const mintaGantiHarga = fullTextLower.includes('harga') && 
                           (fullTextLower.includes('ganti') || fullTextLower.includes('ubah') || fullTextLower.includes('jadi'));

    if (mintaGantiHarga) {
        const priceMatch = fullTextLower.match(/(\d+(?:[.,]\d+)?)\s*(k|rb|ribu)?(?:\b|$)/i);
        if (priceMatch) {
            let nominal = parseFloat(priceMatch[1].replace(',', '.'));
            const unit = priceMatch[2]?.toLowerCase();
            if (unit === 'k' || unit === 'rb' || unit === 'ribu' || nominal < 1000) {
                nominal = Math.round(nominal * 1000);
            }

            const products = db.products || [];
            let target = null;

            if (fullTextLower.includes('wdp 2') || fullTextLower.includes('wdp 2x')) {
                target = products.find(p => p.id === 'wdp2');
            } else if (fullTextLower.includes('wdp') || fullTextLower.includes('pass')) {
                target = products.find(p => p.id === 'wdp1');
            } else if (fullTextLower.includes('86')) {
                target = products.find(p => p.id === 'dm86');
            } else if (fullTextLower.includes('257')) {
                target = products.find(p => p.id === 'dm257');
            } else if (fullTextLower.includes('vp') || fullTextLower.includes('valorant')) {
                target = products.find(p => p.id === 'vct');
            } else {
                target = products.find(p => 
                    fullTextLower.includes(p.id.toLowerCase()) || 
                    fullTextLower.includes(p.name.toLowerCase())
                );
            }

            if (target && nominal > 0) {
                target.price = nominal;
                saveDb(db);
                await delay(1500);
                return await sock.sendMessage(remoteJid, { 
                    text: `Siap bos! Harga *${target.name}* udah aku ganti jadi *Rp ${nominal.toLocaleString('id-ID')}* yaa.` 
                }, { quoted: messageInfo });
            }
        }
    }

    // 2. TAMBAH PRODUK BARU KE KATALOG (GAYA CHAT SEHARI-HARI)
    // Contoh kalimat yang didukung:
    // • "tambah produk ff 70 diamond harga 10k"
    // • "tolong tambahin produk wdp 3x harganya 80rb dong"
    // • "tambah produk robux 100 r$ harga 15000"
    const mintaTambahProduk = fullTextLower.includes('tambah produk') || 
                              fullTextLower.includes('tambahin produk') || 
                              fullTextLower.includes('masukin produk');

    if (mintaTambahProduk) {
        // Ambil harga (misal: 10k, 80rb, 15000)
        const priceMatch = fullTextLower.match(/(?:harga|harganya)?\s*(\d+(?:[.,]\d+)?)\s*(k|rb|ribu)?(?:\b|$)/i);
        if (priceMatch) {
            let nominal = parseFloat(priceMatch[1].replace(',', '.'));
            const unit = priceMatch[2]?.toLowerCase();
            if (unit === 'k' || unit === 'rb' || unit === 'ribu' || nominal < 1000) {
                nominal = Math.round(nominal * 1000);
            }

            // Bersihkan nama produk dari kata-kata perintah
            let namaProduk = trimmedText
                .replace(/^(tolong|min|bos)\s+/i, '')
                .replace(/^(tambah produk|tambahin produk|masukin produk)\s+/i, '')
                .replace(/(?:harga|harganya)?\s*(\d+(?:[.,]\d+)?)\s*(k|rb|ribu)?/i, '')
                .replace(/(dong|ya|kak|min|bos)$/i, '')
                .trim();

            if (namaProduk && nominal > 0) {
                db.products = db.products || [];
                const randomId = 'p_' + Date.now().toString().slice(-4);

                db.products.push({
                    id: randomId,
                    name: namaProduk,
                    price: nominal,
                    desc: `Topup/Produk ${namaProduk} resmi & proses cepat`
                });

                saveDb(db);
                await delay(1500);
                return await sock.sendMessage(remoteJid, { 
                    text: `✅ *Siap bos! Produk baru berhasil ditambah ke katalog:*\n\n📦 *${namaProduk}*\n💰 *Harga:* Rp ${nominal.toLocaleString('id-ID')}\n\nSekarang kalo orang ketik *pricelist* atau *harga*, produk ini udah otomatis muncul!` 
                }, { quoted: messageInfo });
            }
        }
    }

    // 3. GANTI FOTO QRIS (Cukup kirim foto caption "ini qris baru" / "ganti qris", atau reply foto)
    const mintaGantiQris = fullTextLower.includes('qris baru') || 
                           fullTextLower.includes('ganti qris') || 
                           fullTextLower.includes('ini qris') ||
                           fullTextLower.includes('update qris');

    if (mintaGantiQris) {
        const hasDirectImage = messageContent.imageMessage;
        const quotedMsg = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
        const hasQuotedImage = quotedMsg?.imageMessage;

        if (hasDirectImage || hasQuotedImage) {
            try {
                const targetMessage = hasDirectImage ? messageInfo : { message: quotedMsg, key: messageInfo.key };
                const buffer = await downloadMediaMessage(targetMessage, 'buffer', {});
                fs.writeFileSync('./qris.jpg', buffer);

                db.settings = db.settings || {};
                db.settings.useLocalQris = true;
                saveDb(db);

                await delay(1500);
                return await sock.sendMessage(remoteJid, { 
                    text: `Beres bos! Barcode QRIS yang baru udah aku simpen ya. Kalo ada yang minta bayar pake qris, foto ini yang bakal aku kirim.` 
                }, { quoted: messageInfo });
            } catch (err) {
                return await sock.sendMessage(remoteJid, { text: 'Waduh fotonya gagal disimpen nih, coba kirim ulang lagi ya bos.' }, { quoted: messageInfo });
            }
        }
    }

    // 3. TAMBAH RESPON/PERINTAH BARU (Contoh: "tolong kalo ada yang ngetik ff balesnya harga dm ff 10k ya")
    const matchNaturalTambah = fullTextLower.match(/(?:kalo ada yang|kalo|jika|tolong kalo)\s+(?:ngetik|chat|tanya|bilang)\s+(.+?)\s+(?:balesnya|balasnya|jawabnya|jawab aja|balas aja)\s+(.+)/i);
    const matchSimpleTambah = trimmedText.match(/^(?:tambah|balas|set)\s+([a-zA-Z0-9_\-]+)\s*[:=]\s*(.+)/i);

    if (matchNaturalTambah || matchSimpleTambah) {
        let trigger = '';
        let reply = '';

        if (matchNaturalTambah) {
            trigger = matchNaturalTambah[1].trim().toLowerCase().replace(/^!/, '').replace(/["']/g, '');
            reply = trimmedText.slice(trimmedText.toLowerCase().indexOf(matchNaturalTambah[2].toLowerCase())).trim();
        } else if (matchSimpleTambah) {
            trigger = matchSimpleTambah[1].trim().toLowerCase().replace(/^!/, '').replace(/["']/g, '');
            reply = matchSimpleTambah[2].trim();
        }

        db.customCommands[trigger] = reply;
        saveDb(db);

        await delay(1500);
        return await sock.sendMessage(remoteJid, { 
            text: `Siap bos, udah aku inget! Nanti kalo ada yang chat *${trigger}*, langsung aku bales:\n\n"${reply}"` 
        }, { quoted: messageInfo });
    }

    // 4. HAPUS RESPON (Contoh: "hapus kata ff" / "tolong hapus ff dong")
    if (fullTextLower.includes('hapus') && (fullTextLower.includes('kata') || fullTextLower.includes('perintah') || fullTextLower.includes('respon') || fullTextLower.startsWith('hapus '))) {
        const words = fullTextLower.replace(/tolong|dong|min|bos|perintah|kata|respon|hapus/g, '').trim();
        if (words && db.customCommands && db.customCommands[words]) {
            delete db.customCommands[words];
            saveDb(db);
            await delay(1500);
            return await sock.sendMessage(remoteJid, { 
                text: `Udah aku hapus ya kata kunci *${words}* dari daftar ingatan aku!` 
            }, { quoted: messageInfo });
        }
    }

    // 5. CEK DAFTAR PERINTAH (Contoh: "cek perintah apa aja" / "daftar respon")
    if (fullTextLower.includes('perintah apa aja') || fullTextLower.includes('daftar perintah') || fullTextLower.includes('list perintah') || fullTextLower.includes('cek perintah')) {
        const triggers = Object.keys(db.customCommands);
        let txt = `Ini daftar kata yang udah aku hapal ya bos:\n\n`;
        triggers.forEach((t, i) => txt += `• *${t}*\n`);
        txt += `\nKalo orang ngetik kata di atas, langsung aku bales otomatis.`;
        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: txt }, { quoted: messageInfo });
    }

    // 6. KELUARKAN ORANG (KICK) (Cukup reply chat orangnya: "kick" / "tendang" / "keluarin dia" / "kick orang ini")
    const mintaKick = fullTextLower.includes('kick') || 
                      fullTextLower.includes('tendang') || 
                      fullTextLower.includes('keluarin') || 
                      fullTextLower.includes('usir');

    if (mintaKick && isGroup) {
        if (!isBotAdmin) {
            return await sock.sendMessage(remoteJid, { text: 'Jadikan aku admin grup dulu bos biar bisa ngeluarin orang hehe.' }, { quoted: messageInfo });
        }

        const mentionedJid = messageContent.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        const quotedParticipant = messageContent.extendedTextMessage?.contextInfo?.participant;
        const targetJid = mentionedJid || quotedParticipant;

        if (!targetJid) {
            return await sock.sendMessage(remoteJid, { text: 'Reply dulu chat orang yang mau dikeluarin atau tag orangnya ya bos!' }, { quoted: messageInfo });
        }

        // Jika Anda nge-kick dengan cara me-REPLY pesan orang tersebut,
        // sekalian HAPUS pesan orang tersebut untuk semua orang di grup!
        const quotedStanzaId = messageContent.extendedTextMessage?.contextInfo?.stanzaId;
        if (quotedStanzaId) {
            try {
                await sock.sendMessage(remoteJid, {
                    delete: {
                        remoteJid: remoteJid,
                        fromMe: false,
                        id: quotedStanzaId,
                        participant: targetJid
                    }
                });
            } catch (e) {
                console.error('Gagal hapus pesan reply:', e);
            }
        }

        try {
            await sock.groupParticipantsUpdate(remoteJid, [targetJid], 'remove');
            await delay(1500);
            return await sock.sendMessage(remoteJid, { 
                text: `Beres bos! Pesannya udah dihapus dan @${targetJid.split('@')[0]} udah aku keluarin dari grup.`, 
                mentions: [targetJid] 
            });
        } catch (err) {
            return await sock.sendMessage(remoteJid, { text: 'Gagal ngeluarin orangnya nih, kayaknya dia owner grup atau admin juga.' });
        }
    }

    // 7. PANGGIL SEMUA ORANG (TAG ALL) (Contoh: "tagall guys ada promo" atau "panggil semua ada info baru")
    const mintaTagAll = fullTextLower.startsWith('tagall') || 
                        fullTextLower.startsWith('tag all') || 
                        fullTextLower.includes('panggil semua') || 
                        fullTextLower.includes('semuanya kumpul');

    if (mintaTagAll && isGroup) {
        const groupMeta = await sock.groupMetadata(remoteJid);
        const participants = groupMeta.participants.map(p => p.id);
        
        let pesan = trimmedText
            .replace(/^(tagall|tag all|panggil semua|semuanya kumpul)/i, '')
            .trim();
        if (!pesan) pesan = 'Halo semuanya! Ada pengumuman penting nih.';

        let mentionText = `📢 *PENGUMUMAN*\n\n${pesan}\n\n`;
        participants.forEach(p => mentionText += `@${p.split('@')[0]} `);

        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: mentionText, mentions: participants });
    }

    // =========================================================================
    // 🛍️ LAYANAN PEMBELI (CHAT SANTAI SEHARI-HARI)
    // =========================================================================

    // 1. Tanya WDP (Ambil langsung harga terbaru dari database.json!)
    if (fullTextLower.includes('wdp') && !mintaGantiHarga) {
        await delay(1500);
        const wdpProduct = (db.products || []).find(p => p.id === 'wdp1');
        const hargaWdp = wdpProduct ? Number(wdpProduct.price).toLocaleString('id-ID') : '24.000';
        const hargaWdp2 = wdpProduct ? (Number(wdpProduct.price) * 2).toLocaleString('id-ID') : '48.000';
        
        const wdpText = 
`💎 *Harga WDP (Weekly Diamond Pass)*:
• 1 pcs: *Rp ${hargaWdp}*
• 2 pcs: *Rp ${hargaWdp2}*

Format order: ID (Server) & Nickname ya kak!
Ketik *qris* untuk langsung bayar atau ketik *order* buat isi data! 😊`;
        return await sock.sendMessage(remoteJid, { text: wdpText }, { quoted: messageInfo });
    }

    // 2. CEK APAKAH USER MENGETIK NAMA PRODUK DARI KATALOG (Misal: "sl", "dm", "vp", dll.)
    const matchedProduct = (db.products || []).find(p => {
        const pName = p.name.toLowerCase();
        const pId = p.id.toLowerCase();
        return cleanWord === pName || cleanWord === pId || (cleanWord.length >= 2 && pName.split(/\s+/).includes(cleanWord));
    });

    if (matchedProduct && !mintaGantiHarga && !mintaTambahProduk) {
        await delay(1500);
        const prodText = 
`📦 *${matchedProduct.name}*
💰 *Harga:* Rp ${Number(matchedProduct.price).toLocaleString('id-ID')}
ℹ️ *Ket:* ${matchedProduct.desc || 'Proses cepat & terpercaya'}

Ketik *order* untuk format pemesanan, atau ketik *qris* untuk langsung bayar ya kak! 😊`;
        return await sock.sendMessage(remoteJid, { text: prodText }, { quoted: messageInfo });
    }

    // 3. Cek respon custom dari memori bot (selain wdp & produk katalog)
    if (db.customCommands && db.customCommands[cleanWord]) {
        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: db.customCommands[cleanWord] }, { quoted: messageInfo });
    }

    // Minta QRIS (Contoh: "qris", "minta qris", "mau bayar pake qris", "barcode mana")
    if (fullTextLower.includes('qris') || fullTextLower.includes('barcode') || fullTextLower.includes('mau bayar')) {
        const captionText = 
`Ini barcode QRIS resminya ya kak! 😊
Bisa di-scan dari DANA, GoPay, OVO, ShopeePay, BCA, Mandiri, BRI, dll.

Kalo udah transfer, jangan lupa kirim screenshot buktinya ke sini biar langsung diproses yaa kak! 🙏`;

        await delay(1500);
        if (db.settings?.useLocalQris && fs.existsSync('./qris.jpg')) {
            const imageBuffer = fs.readFileSync('./qris.jpg');
            return await sock.sendMessage(remoteJid, { image: imageBuffer, caption: captionText }, { quoted: messageInfo });
        }

        const qrisUrl = db.settings?.qrisUrl;
        if (qrisUrl && qrisUrl.startsWith('http')) {
            return await sock.sendMessage(remoteJid, { image: { url: qrisUrl }, caption: captionText }, { quoted: messageInfo });
        } else {
            return await sock.sendMessage(remoteJid, { text: captionText }, { quoted: messageInfo });
        }
    }

    // Tanya Pricelist / Daftar Produk (Bisa ketik: "list", "harga", "pricelist", "menu", "produk")
    const tanyaDaftarHarga = cleanWord === 'list' || 
                             fullTextLower.includes('pricelist') || 
                             fullTextLower.includes('daftar harga') || 
                             fullTextLower.includes('list harga') || 
                             fullTextLower.includes('jual apa') || 
                             cleanWord === 'harga' ||
                             cleanWord === 'produk';

    if (tanyaDaftarHarga) {
        const products = db.products || [];
        let listText = `Halo kak! Ini daftar produk & harga kita yaa:\n\n`;
        products.forEach((p, idx) => {
            listText += `${idx + 1}. 💎 *${p.name}*\n`;
            listText += `   Harga: *Rp ${Number(p.price).toLocaleString('id-ID')}*\n\n`;
        });
        listText += `Ketik *order* kalo mau pesan, atau ketik *qris* buat langsung bayar kak!`;
        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: listText }, { quoted: messageInfo });
    }

    // Format Order (Contoh: "order", "mau order", "cara pesan", "format order")
    if (fullTextLower.includes('order') || fullTextLower.includes('mau pesan') || fullTextLower.includes('cara beli')) {
        const orderText = 
`Halo kak! Silakan salin & isi format order ini ya:

• *Item:* (Contoh: WDP 1x)
• *User ID (Server):* (Contoh: 12345678 (2109))
• *Nickname:* 
• *Bayar via:* (QRIS / DANA / BCA)

Kirim ke sini ya kak, nanti langsung kita proses secepatnya! 🙏`;
        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: orderText }, { quoted: messageInfo });
    }

    // Sapaan / Menu Utama (Contoh: "p", "halo", "menu", "pagi", "min", "kak")
    if (fullTextLower === 'menu' || fullTextLower === 'halo' || fullTextLower === 'p' || fullTextLower === 'hai' || fullTextLower === 'min' || fullTextLower === 'kak') {
        const menuText = 
`Halo kak! Selamat datang di store kita yaa 😊

Ada yang bisa dibantu? Ketik santai aja kak:
• *wdp* : Cek harga WDP promo
• *harga* : Lihat semua daftar produk
• *qris* : Minta barcode buat transfer
• *order* : Format pemesanan kilat

Silakan kak, admin standby fast respon! 🙏`;
        await delay(1500);
        return await sock.sendMessage(remoteJid, { text: menuText }, { quoted: messageInfo });
    }
}
