const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');

// --- PENGATURAN AI GEMINI ---
const genAI = new GoogleGenerativeAI("AIzaSyDgmJqvPf2NdEnbU1bcWFJAYYJRwcni7wo"); 

// --- DATABASE SEDERHANA (JSON) ---
const dataFolder = './data';
const dbFile = './data/pesanan.json';
const authFolder = './auth_info_baileys';

// Buat folder dan file JSON jika belum ada
if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder);
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify([]));

// Fungsi untuk menyimpan pesanan
function simpanPesanan(nama, produk, jumlah) {
    const dataAwal = JSON.parse(fs.readFileSync(dbFile));
    dataAwal.push({ tanggal: new Date().toISOString(), nama, produk, jumlah });
    fs.writeFileSync(dbFile, JSON.stringify(dataAwal, null, 2));
}

// --- FUNGSI UTAMA BOT ---
async function startBot() {
    // Fitur ini otomatis menyimpan sesi login, sehingga bot tidak perlu scan QR terus menerus
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version, isLatest } = await fetchLatestWaWebVersion();

    let reconnectScheduled = false;

    const sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.windows('Chrome'),
        syncFullHistory: false,
        logger: pino({ level: 'silent' }) // Mematikan log bawaan yang terlalu berisik
    });

    if (!isLatest) {
        console.log(`ℹ️ Menggunakan WA Web versi ${version.join('.')} untuk kompatibilitas koneksi.`);
    }

    // Event ketika kredensial (sesi) diperbarui
    sock.ev.on('creds.update', saveCreds);

    // Event ketika koneksi terputus atau tersambung
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📱 Scan QR Code berikut dengan WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const scheduleReconnect = (delayMs = 3000) => {
                if (reconnectScheduled) return;
                reconnectScheduled = true;
                setTimeout(() => startBot(), delayMs);
            };

            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Kamu telah logout. Silakan scan ulang QR Code.');
                // Hapus sesi lama agar QR muncul saat restart
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                scheduleReconnect(1000);
            } else if (reason === DisconnectReason.badSession) {
                console.log('⚠️ Sesi rusak, menghapus sesi dan memulai ulang...');
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                scheduleReconnect(1000);
            } else if (reason === DisconnectReason.restartRequired) {
                console.log('🔄 Restart diperlukan, menghubungkan ulang...');
                scheduleReconnect(1000);
            } else if (reason === 405) {
                console.log('⚠️ Koneksi ditolak (405). Reset sesi lalu coba scan QR lagi...');
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                console.error('Detail error 405:', lastDisconnect?.error);
                scheduleReconnect(1500);
            } else {
                console.log(`🔄 Koneksi terputus (kode: ${reason}), menghubungkan ulang...`);
                console.error('Detail disconnect:', lastDisconnect?.error);
                scheduleReconnect(3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung ke WhatsApp!');
        }
    });

    // Event ketika ada pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; // Abaikan pesan dari diri sendiri

        const pengirim = msg.key.remoteJid;
        const namaPengirim = msg.pushName || 'Kak';
        
        // Mengambil isi pesan teks (mendukung pesan biasa maupun balasan/extended)
        const pesanText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const pesan = pesanText.toLowerCase().trim();

        // 1. FITUR: AUTO REPLY MENU PRODUK
        if (pesan === 'halo' || pesan === 'menu' || pesan === 'bantuan') {
            const menu = `Halo kak *${namaPengirim}*! 👋\nSelamat datang di Toko Kami.\n\n` +
                         `Berikut perintah yang bisa digunakan:\n` +
                         `🛒 *menu* - Melihat daftar ini\n` +
                         `📋 *katalog* - Melihat daftar produk\n` +
                         `💰 *harga [nama_produk]* - Cek harga spesifik\n` +
                         `📝 *pesan [nama_produk] [jumlah]* - Membuat pesanan\n` +
                         `🤖 *tanya [pertanyaan]* - Tanya AI kami seputar toko`;
            await sock.sendMessage(pengirim, { text: menu });
        }
        
        // 2. FITUR: KATALOG PRODUK
        else if (pesan === 'katalog') {
            const katalog = `*KATALOG PRODUK:*\n\n` +
                            `1. Sepatu Sneakers - Rp 250.000\n` +
                            `2. Kaos Polos - Rp 50.000\n` +
                            `3. Topi Baseball - Rp 35.000\n\n` +
                            `Ketik *pesan [nama_produk] [jumlah]* untuk membeli.`;
            await sock.sendMessage(pengirim, { text: katalog });
        }

        // 3. FITUR: CEK HARGA (Contoh: harga sepatu)
        else if (pesan.startsWith('harga ')) {
            const barang = pesan.split(' ')[1];
            let balas = "Maaf, barang tidak ditemukan.";
            if (barang === 'sepatu') balas = "Harga Sepatu Sneakers adalah Rp 250.000";
            if (barang === 'kaos') balas = "Harga Kaos Polos adalah Rp 50.000";
            await sock.sendMessage(pengirim, { text: balas });
        }

        // 4. FITUR: PESAN PRODUK (Contoh: pesan sepatu 2)
        else if (pesan.startsWith('pesan ')) {
            const parts = pesan.split(' ');
            if (parts.length >= 3) {
                const produk = parts[1];
                const jumlah = parts[2];
                simpanPesanan(namaPengirim, produk, jumlah);
                await sock.sendMessage(pengirim, { text: `✅ Pesanan berhasil dicatat!\n\nNama: ${namaPengirim}\nProduk: ${produk}\nJumlah: ${jumlah}\n\nAdmin akan segera menghubungi Anda untuk pembayaran.` });
            } else {
                await sock.sendMessage(pengirim, { text: `Format salah. Gunakan format: *pesan [nama_produk] [jumlah]*\nContoh: pesan kaos 2` });
            }
        }

        // 5 & 6. FITUR: AI UNTUK MENJAWAB PERTANYAAN (Contoh: tanya apakah toko buka hari minggu?)
        else if (pesan.startsWith('tanya ')) {
            const pertanyaan = pesanText.replace('tanya', '').trim();
            await sock.sendMessage(pengirim, { text: `🤖 Sedang memikirkan jawaban...` });
            
            try {
                // Memberikan konteks (prompt) kepada AI agar dia tahu dia adalah CS toko
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const promptAI = `Kamu adalah Customer Service ramah untuk "Toko Kami". Jawab pertanyaan pelanggan ini dengan singkat, sopan, dan dalam bahasa Indonesia. Pertanyaan: ${pertanyaan}`;
                
                const result = await model.generateContent(promptAI);
                const jawaban = result.response.text();
                
                await sock.sendMessage(pengirim, { text: jawaban });
            } catch (error) {
                await sock.sendMessage(pengirim, { text: `Maaf kak, AI sedang kebingungan atau terjadi error. 🙏` });
                console.error("Error AI:", error);
            }
        }
    });
}

// Menjalankan bot
startBot();