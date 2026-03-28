const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const pendingOrders = new Map();

const PRODUCT_PRICES = {
    original: {
        displayName: 'Dimsum Original',
        prices: { 1: 3000, 3: 9000, 6: 18000, 12: 36000 }
    },
    mentai: {
        displayName: 'Dimsum Mentai',
        prices: { 3: 12000, 6: 23000, 12: 45000 }
    },
    'mentai keju': {
        displayName: 'Dimsum Mentai Keju',
        prices: { 3: 14000, 6: 27000, 12: 53000 }
    }
};

function rupiah(value) {
    return `Rp ${Number(value).toLocaleString('id-ID')}`;
}

function extractTextMessage(msg) {
    return msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || msg.message?.videoMessage?.caption
        || msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption
        || msg.message?.viewOnceMessage?.message?.imageMessage?.caption
        || '';
}

function hasImageAttachment(msg) {
    return Boolean(
        msg.message?.imageMessage
        || msg.message?.viewOnceMessageV2?.message?.imageMessage
        || msg.message?.viewOnceMessage?.message?.imageMessage
    );
}

function normalizePhoneJid(phoneNumber) {
    const onlyDigits = String(phoneNumber || '').replace(/\D/g, '');
    return onlyDigits ? `${onlyDigits}@s.whatsapp.net` : '';
}

function normalizePhoneNumber(phoneNumber) {
    return String(phoneNumber || '').replace(/\D/g, '');
}

function readMappingValue(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        const parsed = JSON.parse(raw);
        return normalizePhoneNumber(parsed);
    } catch (error) {
        return '';
    }
}

function resolveSenderNumber(remoteJid, authFolder) {
    const rawId = String(remoteJid || '').split('@')[0];
    const rawDigits = normalizePhoneNumber(rawId);

    if (!rawDigits) return '';
    if (rawDigits.startsWith('62')) return rawDigits;
    if (!authFolder) return rawDigits;

    const reversePath = path.join(authFolder, `lid-mapping-${rawDigits}_reverse.json`);
    if (fs.existsSync(reversePath)) {
        const mappedNumber = readMappingValue(reversePath);
        if (mappedNumber) return mappedNumber;
    }

    return rawDigits;
}

function isOwnerSender(senderNumber, ownerNumber) {
    const sender = normalizePhoneNumber(senderNumber);
    const owner = normalizePhoneNumber(ownerNumber);
    if (!sender || !owner) return false;
    if (sender === owner) return true;
    return sender.endsWith(owner) || owner.endsWith(sender);
}

function parseOrderInput(pesanText) {
    const lines = pesanText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return { ok: false, reason: 'Silakan ketik pesanan dulu.' };
    }

    const items = [];
    let method = null;
    let totalOrderCount = 0;

    for (const lineRaw of lines) {
        const line = lineRaw.toLowerCase();
        const match = line.match(/^(mentai keju|original|mentai)\s+(\d+)\s+(\d+)\s+(cod|ambil)$/i);
        if (!match) {
            return {
                ok: false,
                reason: `Format tidak valid di baris: "${lineRaw}". Format: nama_menu paket_pcs jumlah_pesanan cod/ambil`
            };
        }

        const menuKey = match[1].toLowerCase();
        const paketPcs = Number(match[2]);
        const jumlahPesanan = Number(match[3]);
        const lineMethod = match[4].toLowerCase();
        const productConfig = PRODUCT_PRICES[menuKey];

        if (!productConfig?.prices[paketPcs]) {
            return {
                ok: false,
                reason: `Paket ${paketPcs} pcs untuk ${productConfig?.displayName || menuKey} tidak tersedia di katalog.`
            };
        }

        if (!Number.isInteger(jumlahPesanan) || jumlahPesanan <= 0) {
            return {
                ok: false,
                reason: 'Jumlah pesanan harus angka bulat lebih dari 0.'
            };
        }

        if (!method) {
            method = lineMethod;
        } else if (method !== lineMethod) {
            return {
                ok: false,
                reason: 'Metode pesanan harus sama semua (pilih salah satu: cod atau ambil).'
            };
        }

        const unitPrice = productConfig.prices[paketPcs];
        const lineTotalPrice = unitPrice * jumlahPesanan;
        totalOrderCount += jumlahPesanan;

        items.push({
            menuKey,
            menuName: productConfig.displayName,
            paketPcs,
            jumlahPesanan,
            unitPrice,
            price: lineTotalPrice
        });
    }

    const total = items.reduce((sum, item) => sum + item.price, 0);
    return { ok: true, items, method, total, totalOrderCount };
}

function buildOrderNote({ nama, nomor, items, method, total, orderId, totalOrderCount }) {
    const lines = [];
    lines.push('=== NOTA PEMESANAN ===');
    lines.push(`ID Pesanan: ${orderId}`);
    lines.push(`Nama: ${nama}`);
    lines.push(`Nomor: ${nomor}`);
    lines.push('');
    lines.push('Detail Pesanan:');

    items.forEach((item, idx) => {
        lines.push(
            `${idx + 1}. ${item.menuName} ${item.paketPcs} pcs x ${item.jumlahPesanan} = ${rupiah(item.price)} `
            + `(harga satuan ${rupiah(item.unitPrice)})`
        );
    });

    lines.push('');
    lines.push(`Jumlah pesanan: ${totalOrderCount}`);
    lines.push(`Metode: ${method.toUpperCase()}`);
    lines.push(`Total: ${rupiah(total)}`);

    return lines.join('\n');
}

function buildCatalogText(ownerPhoneNumber) {
    return '*MENU DIMSUM*\n\n'
        + '*Dimsum Original*\n'
        + '1 pcs = Rp 3.000\n'
        + '3 pcs = Rp 9.000\n'
        + '6 pcs = Rp 18.000\n'
        + '12 pcs = Rp 36.000\n\n'
        + '*Dimsum Mentai*\n'
        + '3 pcs = Rp 12.000\n'
        + '6 pcs = Rp 23.000\n'
        + '12 pcs = Rp 45.000\n\n'
        + '*Dimsum Mentai Keju*\n'
        + '3 pcs = Rp 14.000\n'
        + '6 pcs = Rp 27.000\n'
        + '12 pcs = Rp 53.000\n\n'
        + `Catatan: Mohon tanya stok terlebih dahulu ke penjual: wa.me/${ownerPhoneNumber}`;
}

async function tryDownloadProofImage(msg, sock) {
    try {
        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
                reuploadRequest: sock.updateMediaMessage
            }
        );
        return Buffer.isBuffer(buffer) ? buffer : null;
    } catch (error) {
        console.error('Gagal download media bukti pembayaran:', error);
        return null;
    }
}

function getImageMimeType(msg) {
    return msg.message?.imageMessage?.mimetype
        || msg.message?.viewOnceMessageV2?.message?.imageMessage?.mimetype
        || msg.message?.viewOnceMessage?.message?.imageMessage?.mimetype
        || 'image/jpeg';
}

function guessImageExtension(mimeType) {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    return 'jpg';
}

function ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function createMessageHandler({
    sock,
    simpanPesanan,
    simpanBuktiPembayaran,
    getBuktiPembayaranTerakhirByNomor,
    getBuktiPembayaranTerbaru,
    checkIsFirstTimeUser,
    dbFile,
    authFolder,
    ownerPhoneNumber,
    menuPosterPath,
    qrisImagePath,
    paymentProofFolder
}) {
    const ownerJid = normalizePhoneJid(ownerPhoneNumber);

    return async function onMessageUpsert(m) {
        const msg = m.messages[0];
        if (!msg?.message || msg.key.fromMe) return;

        const pengirim = msg.key.remoteJid;
        const nomorPengirim = resolveSenderNumber(pengirim, authFolder);
        const namaPengirim = msg.pushName || 'Customer';
        const pesanText = extractTextMessage(msg).trim();
        const pesan = pesanText.toLowerCase();
        
        // DEBUG: Log semua informasi nomor yang tersedia
        if (pesan === 'debug nomor' || pesan === 'cek nomor') {
            console.log('\n🔍 DETAILED DEBUG INFO:');
            console.log('  1. msg.key.remoteJid:', msg.key.remoteJid);
            console.log('  2. msg.key.participant:', msg.key.participant);
            console.log('  3. msg.key.id:', msg.key.id);
            console.log('  4. msg.sender:', msg.sender);
            console.log('  5. msg.from:', msg.from);
            console.log('  6. msg.pushName:', msg.pushName);
            console.log('  7. msg.verifiedBizName:', msg.verifiedBizName);
            console.log('  8. msg.message keys:', Object.keys(msg.message || {}));
            console.log('  9. Full msg.key:', JSON.stringify(msg.key));
            
            const nomor1 = String(msg.key.remoteJid || '').split('@')[0];
            const nomor2 = msg.key.participant ? String(msg.key.participant).split('@')[0] : 'N/A';
            const nomor3 = msg.sender ? String(msg.sender).split('@')[0] : 'N/A';
            const nomorResolved = resolveSenderNumber(msg.key.remoteJid, authFolder);
            
            await sock.sendMessage(pengirim, {
                text: `🔍 DEBUG - COBA NOMOR MANA YANG CORRECT?\n\nOption 1 (remoteJid): ${nomor1}\nOption 2 (participant): ${nomor2}\nOption 3 (sender): ${nomor3}\nResolved (dipakai nota): ${nomorResolved}\n\nKalau customer mu 628139796719, pilih yang mana?`
            });
            return;
        }
        
        const isOwner = isOwnerSender(nomorPengirim, ownerPhoneNumber);
        const pending = pendingOrders.get(pengirim);
        const isCmdMenu = ['1', 'menu', 'halo', 'bantuan'].includes(pesan);
        const isCmdPemesanan = ['2', 'pemesanan', 'order'].includes(pesan);
        const isCmdNota = ['3', 'nota'].includes(pesan);
        const isCmdChatPemilik = ['4', 'chat pemilik', 'penjual', 'pemilik'].includes(pesan);
        
        // Detect order attempt (format: menu paket jumlah cod/ambil)
        const isOrderAttempt = /^(original|mentai|mentai keju)\s+\d+\s+\d+\s+(cod|ambil)/i.test(pesanText.trim());
        const isAnyCommand = isCmdMenu || isCmdPemesanan || isCmdNota || isCmdChatPemilik || isOrderAttempt;

        // Cek jika user pertama kali dan TIDAK mengirim command atau order attempt
        const isFirstTime = !isOwner && await checkIsFirstTimeUser(dbFile, nomorPengirim);
        if (isFirstTime && !isAnyCommand) {
            const welcomeMsg = `Hai *${namaPengirim}* 👋😄\n\n`
                + '🤖 Bot ini adalah *Bot Pemesanan Dimsum*! \n\n'
                + 'Kamu bisa pesan dimsum favorit kamu dengan mudah. Ini menu perintahnya:\n\n'
                + '1️⃣ *menu* = lihat semua menu + harga\n'
                + '2️⃣ *pemesanan* = mulai order\n'
                + '3️⃣ *nota* = lihat nota + bukti pembayaran terakhir\n'
                + '4️⃣ *chat pemilik* = hubungi seller\n\n'
                + '_Tips: Kamu bisa pakai angka atau teks commandnya!_ ✨\n\n'
                + 'Ketik salah satu command di atas untuk memulai 😊';

            await sock.sendMessage(pengirim, { text: welcomeMsg });
            return;
        }

        if (pending?.status === 'awaiting_proof' && hasImageAttachment(msg)) {
            const proofImageBuffer = await tryDownloadProofImage(msg, sock);
            const imageMimeType = getImageMimeType(msg);
            let imageFilePath = null;

            if (proofImageBuffer && paymentProofFolder) {
                ensureDir(paymentProofFolder);
                const ext = guessImageExtension(imageMimeType);
                const fileName = `${pending.orderId || 'ORD'}_${Date.now()}.${ext}`;
                imageFilePath = path.join(paymentProofFolder, fileName);
                fs.writeFileSync(imageFilePath, proofImageBuffer);
            }

            await simpanBuktiPembayaran(dbFile, {
                orderId: pending.orderId,
                nama: namaPengirim,
                nomor: pending.nomorPengirim || nomorPengirim,
                nota: pending.note,
                total: pending.total,
                metode: pending.method,
                mimeType: imageMimeType,
                gambarBase64: proofImageBuffer ? proofImageBuffer.toString('base64') : null,
                imageFilePath,
                messageId: msg.key?.id || null
            });

            console.log(`✅ Bukti pembayaran disimpan - Nomor: ${pending.nomorPengirim || nomorPengirim}`);

            await sock.sendMessage(pengirim, {
                text: 'Makasih ya kak! 🫶 Bukti pembayaran + nota udah masuk. Ditunggu dulu ya, seller lagi cek 🙏'
            });

            if (ownerJid) {
                const ringkas = `*BUKTI PEMBAYARAN MASUK* 💸\n\n${pending.note}\n\nStatus: menunggu verifikasi seller.`;
                await sock.sendMessage(ownerJid, { text: ringkas });
                try {
                    await sock.sendMessage(ownerJid, { forward: msg });
                } catch (error) {
                    console.error('Gagal forward bukti ke pemilik:', error);
                }
            }

            pendingOrders.delete(pengirim);
            return;
        }

        if (isCmdMenu) {
            const menuText = `Haiii *${namaPengirim}* 👋😄\n\n`
                + 'Ini menu bot yang bisa kamu pakai:\n'
                + '1️⃣ *menu* = lihat menu + gambar\n'
                + '2️⃣ *pemesanan* = mulai order\n'
                + '3️⃣ *nota* = lihat nota+bukti bayar terakhir\n'
                + '4️⃣ *chat pemilik* = kontak seller\n\n'
                + 'Tips: kamu bisa pakai angka atau teks commandnya ya ✨';

            if (menuPosterPath && fs.existsSync(menuPosterPath)) {
                await sock.sendMessage(pengirim, {
                    image: { url: menuPosterPath },
                    caption: `${buildCatalogText(ownerPhoneNumber)}\n\n${menuText}`
                });
            } else {
                await sock.sendMessage(pengirim, {
                    text: `${buildCatalogText(ownerPhoneNumber)}\n\n${menuText}`
                });
            }
            return;
        }

        if (isCmdChatPemilik) {
            await sock.sendMessage(pengirim, {
                text: `Mau tanya-tanya seputar toko? Langsung japri seller di sini ya 📱\nwa.me/${ownerPhoneNumber}`
            });
            return;
        }

        if (isCmdNota) {
            if (isOwner) {
                const latestProofs = await getBuktiPembayaranTerbaru(dbFile, 10);
                if (!latestProofs.length) {
                    await sock.sendMessage(pengirim, {
                        text: 'Belum ada bukti pembayaran yang tersimpan saat ini 👀'
                    });
                    return;
                }

                await sock.sendMessage(pengirim, {
                    text: `Ada ${latestProofs.length} bukti pembayaran terbaru. Aku kirim satu-satu ya 📦`
                });

                for (const row of latestProofs) {
                    const caption = `*NOTA #${row.id}*\nTanggal: ${row.tanggal}\nNama: ${row.nama}\nNomor: ${row.nomor}\nMetode: ${row.metode}\nTotal: ${row.total}\n\n${row.nota}`;
                    let sent = false;

                    if (row.image_file_path && fs.existsSync(row.image_file_path)) {
                        await sock.sendMessage(pengirim, {
                            image: { url: row.image_file_path },
                            caption
                        });
                        sent = true;
                    } else if (row.gambar_base64) {
                        await sock.sendMessage(pengirim, {
                            image: Buffer.from(row.gambar_base64, 'base64'),
                            mimetype: row.mime_type || 'image/jpeg',
                            caption
                        });
                        sent = true;
                    }

                    if (!sent) {
                        await sock.sendMessage(pengirim, {
                            text: `${caption}\n\n(Bukti gambar tidak ditemukan)`
                        });
                    }
                }
                return;
            }

            const lastProof = await getBuktiPembayaranTerakhirByNomor(dbFile, nomorPengirim);
            if (!lastProof) {
                await sock.sendMessage(pengirim, {
                    text: 'Belum ada nota pembayaran tersimpan buat nomor kamu 🙈\nCoba lakukan pemesanan dulu ya.'
                });
                return;
            }

            const notaText = `Ini nota+bukti bayar terakhir kamu ya 🧾\n\n${lastProof.nota}`;
            if (lastProof.image_file_path && fs.existsSync(lastProof.image_file_path)) {
                await sock.sendMessage(pengirim, {
                    image: { url: lastProof.image_file_path },
                    caption: notaText
                });
            } else if (lastProof.gambar_base64) {
                await sock.sendMessage(pengirim, {
                    image: Buffer.from(lastProof.gambar_base64, 'base64'),
                    mimetype: lastProof.mime_type || 'image/jpeg',
                    caption: notaText
                });
            } else {
                await sock.sendMessage(pengirim, { text: `${notaText}\n\n(Bukti gambar tidak tersimpan)` });
            }
            return;
        }

        if (isCmdPemesanan) {
            const katalog = buildCatalogText(ownerPhoneNumber);

            if (menuPosterPath && fs.existsSync(menuPosterPath)) {
                await sock.sendMessage(pengirim, {
                    image: { url: menuPosterPath },
                    caption: katalog
                });
            } else {
                await sock.sendMessage(pengirim, { text: katalog });
            }

            await sock.sendMessage(pengirim, {
                text: 'Ketik pesanan anda dengan format:\n'
                    + '*nama_menu paket_pcs jumlah_pesanan cod/ambil*\n\n'
                    + 'Contoh:\n'
                    + 'original 3 1 cod\n'
                    + 'mentai keju 6 2 cod\n\n'
                    + 'Kalau pesan lebih dari 1 menu, pisahkan pakai baris baru ya 😉'
            });
            return;
        }

        if (pesan === 'konfirmasi' && pending?.status === 'awaiting_confirmation') {
            pending.status = 'awaiting_proof';

            if (qrisImagePath && fs.existsSync(qrisImagePath)) {
                await sock.sendMessage(pengirim, {
                    image: { url: qrisImagePath },
                    caption: `Yuk lanjut bayar pakai QRIS 💜\nTotal bayar: *${rupiah(pending.total)}*\n\n${pending.note}`
                });
            } else {
                await sock.sendMessage(pengirim, {
                    text: `Yuk lanjut bayar ya 💸\nTotal bayar: *${rupiah(pending.total)}*\n\n(Info: file QRIS belum ditemukan di server)\n\n${pending.note}`
                });
            }

            await sock.sendMessage(pengirim, {
                text: 'Setelah bayar, kirim *screenshot bukti pembayaran* + *nota pesanan* (copy dari atas) dalam satu pesan ya ✅'
            });
            return;
        }

        if (pending?.status === 'awaiting_confirmation' && pesan !== 'konfirmasi') {
            await sock.sendMessage(pengirim, {
                text: 'Kalau udah cocok, ketik *konfirmasi* ya biar lanjut ke QRIS 😎'
            });
            return;
        }

        const parsedOrder = parseOrderInput(pesanText);
        if (parsedOrder.ok) {
            const orderId = `ORD-${Date.now()}`;
            const orderNote = buildOrderNote({
                nama: namaPengirim,
                nomor: nomorPengirim,
                items: parsedOrder.items,
                method: parsedOrder.method,
                total: parsedOrder.total,
                orderId,
                totalOrderCount: parsedOrder.totalOrderCount
            });

            console.log(`📝 Order baru - Nama: ${namaPengirim}, Nomor: ${nomorPengirim}, OrderID: ${orderId}`);

            pendingOrders.set(pengirim, {
                status: 'awaiting_confirmation',
                note: orderNote,
                total: parsedOrder.total,
                orderId,
                method: parsedOrder.method,
                nomorPengirim
            });

            await simpanPesanan(
                dbFile,
                namaPengirim,
                orderNote,
                String(parsedOrder.total),
                parsedOrder.totalOrderCount,
                nomorPengirim
            );

            console.log(`💾 Pesanan disimpan - Nomor ke DB: ${nomorPengirim}`);

            await sock.sendMessage(pengirim, {
                text: `${orderNote}\n\nCatatan: cek stok dulu ke seller ya (${ownerPhoneNumber}) 📞\nKalau pesanan sudah pas, ketik *konfirmasi*.`
            });
            return;
        }

        const isLikelyOrderAttempt = /^(original|mentai|mentai keju)\b/i.test(pesanText.trim())
            || pesanText.includes('cod')
            || pesanText.includes('ambil');

        if (isLikelyOrderAttempt) {
            await sock.sendMessage(pengirim, {
                text: `${parsedOrder.reason}\n\nContoh format benar:\noriginal 3 1 cod\nmentai keju 6 2 cod`
            });
            return;
        }

        if (pesanText) {
            await sock.sendMessage(pengirim, {
                text: `Untuk hal di luar order, langsung chat seller aja ya 🙌\nwa.me/${ownerPhoneNumber}`
            });
        }
    };
}

module.exports = {
    createMessageHandler
};
