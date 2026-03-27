const {
	default: makeWASocket,
	useMultiFileAuthState,
	fetchLatestWaWebVersion,
	Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const { AUTH_FOLDER, DATA_FOLDER, DB_FILE, LEGACY_JSON_DB_FILE, GEMINI_API_KEY } = require('./config/appConfig');
const { ensureDatabase, simpanPesanan } = require('./services/database');
const { createAIService } = require('./services/aiService');
const { createConnectionHandler } = require('./handlers/connectionHandler');
const { createMessageHandler } = require('./handlers/messageHandler');

const aiService = createAIService(GEMINI_API_KEY);

async function startBot() {
	await ensureDatabase(DATA_FOLDER, DB_FILE, LEGACY_JSON_DB_FILE);

	const botStatus = {
		connected: false,
		lastUpdate: new Date().toISOString()
	};

	const setBotStatus = (connected) => {
		botStatus.connected = connected;
		botStatus.lastUpdate = new Date().toISOString();
		console.log(`📡 Status bot: ${connected ? 'AKTIF' : 'BELUM AKTIF'} (${botStatus.lastUpdate})`);
	};

	const getBotStatus = () => ({ ...botStatus });

	const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
	const { version, isLatest } = await fetchLatestWaWebVersion();

	const sock = makeWASocket({
		auth: state,
		version,
		browser: Browsers.windows('Chrome'),
		syncFullHistory: false,
		logger: pino({ level: 'silent' })
	});

	if (!isLatest) {
		console.log(`ℹ️ Menggunakan WA Web versi ${version.join('.')} untuk kompatibilitas koneksi.`);
	}

	sock.ev.on('creds.update', saveCreds);

	const onConnectionUpdate = createConnectionHandler({
		startBot,
		authFolder: AUTH_FOLDER,
		setBotStatus
	});
	sock.ev.on('connection.update', onConnectionUpdate);

	const onMessageUpsert = createMessageHandler({
		sock,
		simpanPesanan,
		dbFile: DB_FILE,
		jawabPertanyaanToko: aiService.jawabPertanyaanToko,
		getBotStatus
	});
	sock.ev.on('messages.upsert', onMessageUpsert);
}

startBot();