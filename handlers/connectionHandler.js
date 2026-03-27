const fs = require('fs');
const { Boom } = require('@hapi/boom');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

function createConnectionHandler({ startBot, authFolder, setBotStatus }) {
    let reconnectScheduled = false;

    return function onConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            setBotStatus(false);
            console.log('📱 Scan QR Code berikut dengan WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            setBotStatus(false);
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const scheduleReconnect = (delayMs = 3000) => {
                if (reconnectScheduled) return;
                reconnectScheduled = true;
                setTimeout(() => {
                    startBot();
                }, delayMs);
            };

            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Kamu telah logout. Silakan scan ulang QR Code.');
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
            setBotStatus(true);
            console.log('✅ Bot berhasil terhubung ke WhatsApp!');
        }
    };
}

module.exports = {
    createConnectionHandler
};
