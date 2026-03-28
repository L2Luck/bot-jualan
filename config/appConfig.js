const path = require('path');

const ROOT_DIR = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const DATA_FOLDER = path.join(ROOT_DIR, 'data');
const DB_FILE = path.join(DATA_FOLDER, 'pesanan.db');
const LEGACY_JSON_DB_FILE = path.join(DATA_FOLDER, 'pesanan.json');
const AUTH_FOLDER = path.join(ROOT_DIR, 'auth_info_baileys');
const MENU_POSTER_PATH = path.join(ROOT_DIR, 'assets', 'menu-poster.jpg');
const QRIS_IMAGE_PATH = path.join(ROOT_DIR, 'assets', 'qris.jpg');
const PAYMENT_PROOF_FOLDER = path.join(ROOT_DIR, 'data', 'payment_proofs');
const OWNER_PHONE_NUMBER = process.env.OWNER_PHONE_NUMBER || '6285228143799';

module.exports = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AIzaSyDgmJqvPf2NdEnbU1bcWFJAYYJRwcni7wo',
    DATA_FOLDER,
    DB_FILE,
    LEGACY_JSON_DB_FILE,
    AUTH_FOLDER,
    MENU_POSTER_PATH,
    QRIS_IMAGE_PATH,
    PAYMENT_PROOF_FOLDER,
    OWNER_PHONE_NUMBER
};
