const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

let dbInstance = null;
let dbInitialized = false;

function getDb(dbFile) {
    if (!dbInstance) {
        dbInstance = new sqlite3.Database(dbFile, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            }
        });
    }
    return dbInstance;
}

async function initializeDatabase(db) {
    if (dbInitialized) return;
    
    // Enable WAL mode dan set busy timeout dengan proper error handling
    await new Promise((resolve) => {
        db.run('PRAGMA journal_mode = WAL', () => {
            db.run('PRAGMA busy_timeout = 5000', () => {
                db.run('PRAGMA synchronous = NORMAL', () => {
                    dbInitialized = true;
                    console.log('✅ Database initialized dengan WAL mode');
                    resolve();
                });
            });
        });
    });
}

function runWithRetry(db, sql, params = [], retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            db.run(sql, params, function onRun(err) {
                if (err) {
                    if (err.code === 'SQLITE_BUSY' && retries > 0) {
                        console.warn(`⚠️ Database busy, retry... (${retries} left)`);
                        setTimeout(() => {
                            runWithRetry(db, sql, params, retries - 1)
                                .then(resolve)
                                .catch(reject);
                        }, 100);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(this);
                }
            });
        };
        attempt();
    });
}

function run(db, sql, params = []) {
    return runWithRetry(db, sql, params);
}

function getWithRetry(db, sql, params = [], retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    if (err.code === 'SQLITE_BUSY' && retries > 0) {
                        console.warn(`⚠️ Database busy (get), retry... (${retries} left)`);
                        setTimeout(() => {
                            getWithRetry(db, sql, params, retries - 1)
                                .then(resolve)
                                .catch(reject);
                        }, 100);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(row);
                }
            });
        };
        attempt();
    });
}

function get(db, sql, params = []) {
    return getWithRetry(db, sql, params);
}

function allWithRetry(db, sql, params = [], retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    if (err.code === 'SQLITE_BUSY' && retries > 0) {
                        console.warn(`⚠️ Database busy (all), retry... (${retries} left)`);
                        setTimeout(() => {
                            allWithRetry(db, sql, params, retries - 1)
                                .then(resolve)
                                .catch(reject);
                        }, 100);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(rows);
                }
            });
        };
        attempt();
    });
}

function all(db, sql, params = []) {
    return allWithRetry(db, sql, params);
}

async function ensureColumn(db, tableName, columnName, alterSql) {
    const columns = await all(db, `PRAGMA table_info(${tableName})`);
    const hasColumn = columns.some((col) => col.name === columnName);
    if (!hasColumn) {
        await run(db, alterSql);
    }
}

async function migrateLegacyJsonIfNeeded(db, legacyJsonDbFile) {
    if (!legacyJsonDbFile || !fs.existsSync(legacyJsonDbFile)) {
        return;
    }

    let legacyData = [];
    try {
        legacyData = JSON.parse(fs.readFileSync(legacyJsonDbFile, 'utf8'));
    } catch (error) {
        console.error('⚠️ Gagal membaca data JSON lama, lewati migrasi:', error);
        return;
    }

    if (!Array.isArray(legacyData) || legacyData.length === 0) {
        return;
    }

    const countResult = await get(db, 'SELECT COUNT(*) AS total FROM pesanan');
    if ((countResult?.total || 0) > 0) {
        return;
    }

    await run(db, 'BEGIN TRANSACTION');
    try {
        for (const row of legacyData) {
            await run(
                db,
                'INSERT INTO pesanan (tanggal, nama, produk, jumlah) VALUES (?, ?, ?, ?)',
                [
                    row?.tanggal || new Date().toISOString(),
                    row?.nama || 'Kak',
                    row?.produk || '-',
                    String(row?.jumlah || '')
                ]
            );
        }
        await run(db, 'COMMIT');
        console.log(`✅ Migrasi JSON ke SQLite selesai (${legacyData.length} data).`);
    } catch (error) {
        await run(db, 'ROLLBACK');
        throw error;
    }
}

async function ensureDatabase(dataFolder, dbFile, legacyJsonDbFile) {
    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    const db = getDb(dbFile);
    await initializeDatabase(db);
    
    await run(
        db,
        'CREATE TABLE IF NOT EXISTS pesanan (id INTEGER PRIMARY KEY AUTOINCREMENT, tanggal TEXT NOT NULL, nama TEXT NOT NULL, produk TEXT NOT NULL, jumlah TEXT NOT NULL, jumlah_pesanan INTEGER NOT NULL DEFAULT 1)'
    );

    await ensureColumn(
        db,
        'pesanan',
        'jumlah_pesanan',
        'ALTER TABLE pesanan ADD COLUMN jumlah_pesanan INTEGER NOT NULL DEFAULT 1'
    );

    await ensureColumn(
        db,
        'pesanan',
        'nomor',
        'ALTER TABLE pesanan ADD COLUMN nomor TEXT'
    );

    await run(
        db,
        'CREATE TABLE IF NOT EXISTS bukti_pembayaran (id INTEGER PRIMARY KEY AUTOINCREMENT, tanggal TEXT NOT NULL, order_id TEXT, nama TEXT NOT NULL, nomor TEXT NOT NULL, nota TEXT NOT NULL, total TEXT NOT NULL, metode TEXT NOT NULL, mime_type TEXT, gambar_base64 TEXT, image_file_path TEXT, message_id TEXT)'
    );

    await ensureColumn(
        db,
        'bukti_pembayaran',
        'image_file_path',
        'ALTER TABLE bukti_pembayaran ADD COLUMN image_file_path TEXT'
    );

    await migrateLegacyJsonIfNeeded(db, legacyJsonDbFile);
}

async function simpanPesanan(dbFile, nama, produk, jumlah, jumlahPesanan = 1, nomor = null) {
    const db = getDb(dbFile);
    await run(
        db,
        'INSERT INTO pesanan (tanggal, nama, produk, jumlah, jumlah_pesanan, nomor) VALUES (?, ?, ?, ?, ?, ?)',
        [new Date().toISOString(), nama, produk, String(jumlah), Number(jumlahPesanan) || 1, nomor]
    );
}

async function simpanBuktiPembayaran(dbFile, payload) {
    const db = getDb(dbFile);
    await run(
        db,
        'INSERT INTO bukti_pembayaran (tanggal, order_id, nama, nomor, nota, total, metode, mime_type, gambar_base64, image_file_path, message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            new Date().toISOString(),
            payload.orderId || null,
            payload.nama || '-',
            payload.nomor || '-',
            payload.nota || '-',
            String(payload.total || ''),
            String(payload.metode || ''),
            payload.mimeType || null,
            payload.gambarBase64 || null,
            payload.imageFilePath || null,
            payload.messageId || null
        ]
    );
}

async function getBuktiPembayaranTerakhirByNomor(dbFile, nomor) {
    const db = getDb(dbFile);
    return get(
        db,
        'SELECT * FROM bukti_pembayaran WHERE nomor = ? ORDER BY id DESC LIMIT 1',
        [nomor]
    );
}

async function getBuktiPembayaranTerbaru(dbFile, limit = 10) {
    const db = getDb(dbFile);
    return all(
        db,
        'SELECT * FROM bukti_pembayaran ORDER BY id DESC LIMIT ?',
        [Number(limit) || 10]
    );
}

async function clearDatabase(dbFile) {
    const db = getDb(dbFile);
    await run(db, 'DELETE FROM pesanan');
    await run(db, 'DELETE FROM bukti_pembayaran');
    console.log('🗑️ Database berhasil dibersihkan.');
}

async function checkIsFirstTimeUser(dbFile, nomorPengirim) {
    const db = getDb(dbFile);
    const result = await get(
        db,
        'SELECT COUNT(*) as count FROM pesanan WHERE nomor = ?',
        [nomorPengirim]
    );
    return (result?.count || 0) === 0;
}

module.exports = {
    ensureDatabase,
    simpanPesanan,
    simpanBuktiPembayaran,
    getBuktiPembayaranTerakhirByNomor,
    getBuktiPembayaranTerbaru,
    clearDatabase,
    checkIsFirstTimeUser
};
