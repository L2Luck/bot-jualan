const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

let dbInstance = null;

function getDb(dbFile) {
    if (!dbInstance) {
        dbInstance = new sqlite3.Database(dbFile);
    }
    return dbInstance;
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
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
    await run(
        db,
        'CREATE TABLE IF NOT EXISTS pesanan (id INTEGER PRIMARY KEY AUTOINCREMENT, tanggal TEXT NOT NULL, nama TEXT NOT NULL, produk TEXT NOT NULL, jumlah TEXT NOT NULL)'
    );

    await migrateLegacyJsonIfNeeded(db, legacyJsonDbFile);
}

async function simpanPesanan(dbFile, nama, produk, jumlah) {
    const db = getDb(dbFile);
    await run(
        db,
        'INSERT INTO pesanan (tanggal, nama, produk, jumlah) VALUES (?, ?, ?, ?)',
        [new Date().toISOString(), nama, produk, String(jumlah)]
    );
}

module.exports = {
    ensureDatabase,
    simpanPesanan
};
