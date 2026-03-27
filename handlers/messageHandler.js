function createMessageHandler({ sock, simpanPesanan, dbFile, jawabPertanyaanToko, getBotStatus }) {
    return async function onMessageUpsert(m) {
        const msg = m.messages[0];
        if (!msg?.message || msg.key.fromMe) return;

        const pengirim = msg.key.remoteJid;
        const namaPengirim = msg.pushName || 'Kak';
        const pesanText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const pesan = pesanText.toLowerCase().trim();

        if (pesan === 'halo' || pesan === 'menu' || pesan === 'bantuan') {
            const menu = `Halo kak *${namaPengirim}*! 👋\nSelamat datang di Toko Kami.\n\n`
                + 'Berikut perintah yang bisa digunakan:\n'
                + '🛒 *menu* - Melihat daftar ini\n'
                + '📋 *katalog* - Melihat daftar produk\n'
                + '💰 *harga [nama_produk]* - Cek harga spesifik\n'
                + '📝 *pesan [nama_produk] [jumlah]* - Membuat pesanan\n'
                + '📡 *status* - Cek status koneksi bot\n'
                + '🤖 *tanya [pertanyaan]* - Tanya AI kami seputar toko';
            await sock.sendMessage(pengirim, { text: menu });
            return;
        }

        if (pesan === 'status') {
            const statusBot = getBotStatus();
            const textStatus = statusBot.connected ? 'AKTIF' : 'BELUM AKTIF';
            await sock.sendMessage(pengirim, {
                text: `📡 Status bot saat ini: *${textStatus}*\nUpdate terakhir: ${statusBot.lastUpdate}`
            });
            return;
        }

        if (pesan === 'katalog') {
            const katalog = '*KATALOG PRODUK:*\n\n'
                + '1. Sepatu Sneakers - Rp 250.000\n'
                + '2. Kaos Polos - Rp 50.000\n'
                + '3. Topi Baseball - Rp 35.000\n\n'
                + 'Ketik *pesan [nama_produk] [jumlah]* untuk membeli.';
            await sock.sendMessage(pengirim, { text: katalog });
            return;
        }

        if (pesan.startsWith('harga ')) {
            const barang = pesan.split(' ')[1];
            let balas = 'Maaf, barang tidak ditemukan.';
            if (barang === 'sepatu') balas = 'Harga Sepatu Sneakers adalah Rp 250.000';
            if (barang === 'kaos') balas = 'Harga Kaos Polos adalah Rp 50.000';
            await sock.sendMessage(pengirim, { text: balas });
            return;
        }

        if (pesan.startsWith('pesan ')) {
            const parts = pesan.split(' ');
            if (parts.length >= 3) {
                const produk = parts[1];
                const jumlah = parts[2];
                await simpanPesanan(dbFile, namaPengirim, produk, jumlah);
                await sock.sendMessage(pengirim, {
                    text: `✅ Pesanan berhasil dicatat!\n\nNama: ${namaPengirim}\nProduk: ${produk}\nJumlah: ${jumlah}\n\nAdmin akan segera menghubungi Anda untuk pembayaran.`
                });
            } else {
                await sock.sendMessage(pengirim, {
                    text: 'Format salah. Gunakan format: *pesan [nama_produk] [jumlah]*\nContoh: pesan kaos 2'
                });
            }
            return;
        }

        if (pesan.startsWith('tanya ')) {
            const pertanyaan = pesanText.replace('tanya', '').trim();
            await sock.sendMessage(pengirim, { text: '🤖 Sedang memikirkan jawaban...' });

            try {
                const jawaban = await jawabPertanyaanToko(pertanyaan);
                await sock.sendMessage(pengirim, { text: jawaban });
            } catch (error) {
                await sock.sendMessage(pengirim, { text: 'Maaf kak, AI sedang kebingungan atau terjadi error. 🙏' });
                console.error('Error AI:', error);
            }
        }
    };
}

module.exports = {
    createMessageHandler
};
