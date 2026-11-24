import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'readline';
import fs from 'fs';
import { handleMessages } from './handler.js';

// Fungsi input dari terminal untuk meminta nomor WhatsApp
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Nomor WhatsApp bisa diatur lewat menu Environment di Bot-Hosting (NOMOR_WA),
// atau jika tidak diisi, akan otomatis memakai nomor default di bawah ini:
const PHONE_NUMBER = process.env.NOMOR_WA || process.env.PHONE_NUMBER || '6282316375856';

async function connectToWhatsApp(isRestart = false) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        // Gunakan identitas resmi Chrome Mac OS yang paling diakui server WhatsApp
        browser: ['Mac OS', 'Chrome', '124.0.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        generateHighQualityLinkPreview: true
    });

    // JIKA BELUM LOGIN: Minta Pairing Code ke WhatsApp
    if (!sock.authState.creds.registered) {
        console.log('\n=======================================');
        console.log('📱 FITUR PAIRING CODE (OTOMATIS TANPA KETIK MANUAL)');
        console.log('=======================================');
        
        let phoneNumber = PHONE_NUMBER.replace(/[^0-9]/g, '');
        console.log(`👉 Meminta kode untuk nomor: ${phoneNumber}`);

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n---------------------------------------');
                console.log(`🔑 KODE PAIRING ANDA: \x1b[32m\x1b[1m${code}\x1b[0m`);
                console.log('---------------------------------------');
                console.log('Cara Memasukkannya di HP:');
                console.log('1. Buka WhatsApp di HP');
                console.log('2. Titik 3 / Pengaturan -> Perangkat Tertaut');
                console.log('3. Klik "Tautkan Perangkat"');
                console.log('4. Klik tulisan di bawah: "Tautkan dengan nomor telepon saja"');
                console.log(`5. Masukkan kode: ${code}\n`);
            } catch (err) {
                console.error('Gagal membuat Pairing Code:', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n=======================================');
            console.log('✅ Bot WhatsApp Jualan Berhasil Terhubung!');
            console.log('=======================================\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`⚠️ Koneksi terputus (Status: ${statusCode})`);

            if (shouldReconnect) {
                console.log('🔄 Menghubungkan ulang dalam 5 detik...');
                setTimeout(() => connectToWhatsApp(true), 5000);
            } else {
                console.log('❌ Sesi logout. Hapus folder auth_info lalu login ulang.');
            }
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            await handleMessages(sock, chatUpdate);
        } catch (error) {
            console.error('Error pesan:', error);
        }
    });
}

connectToWhatsApp();
