const path = require('path');

const ROOT_DIR = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const DATA_FOLDER = path.join(ROOT_DIR, 'data');
const DB_FILE = path.join(DATA_FOLDER, 'pesanan.db');
const LEGACY_JSON_DB_FILE = path.join(DATA_FOLDER, 'pesanan.json');
const AUTH_FOLDER = path.join(ROOT_DIR, 'auth_info_baileys');

module.exports = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AIzaSyDgmJqvPf2NdEnbU1bcWFJAYYJRwcni7wo',
    DATA_FOLDER,
    DB_FILE,
    LEGACY_JSON_DB_FILE,
    AUTH_FOLDER
};
