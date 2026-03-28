const {
	default: makeWASocket,
	useMultiFileAuthState,
	fetchLatestWaWebVersion,
	Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const {
	AUTH_FOLDER,
	DATA_FOLDER,
	DB_FILE,
	LEGACY_JSON_DB_FILE,
	GEMINI_API_KEY,
	MENU_POSTER_PATH,
	QRIS_IMAGE_PATH,
	PAYMENT_PROOF_FOLDER,
	OWNER_PHONE_NUMBER
} = require('./config/appConfig');
const {
	ensureDatabase,
	simpanPesanan,
	simpanBuktiPembayaran,
	getBuktiPembayaranTerakhirByNomor,
	getBuktiPembayaranTerbaru,
	checkIsFirstTimeUser
} = require('./services/database');
const { createConnectionHandler } = require('./handlers/connectionHandler');
const { createMessageHandler } = require('./handlers/messageHandler');

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
		simpanBuktiPembayaran,
		getBuktiPembayaranTerakhirByNomor,
		getBuktiPembayaranTerbaru,
		checkIsFirstTimeUser,
		dbFile: DB_FILE,
		authFolder: AUTH_FOLDER,
		getBotStatus,
		ownerPhoneNumber: OWNER_PHONE_NUMBER,
		menuPosterPath: MENU_POSTER_PATH,
		qrisImagePath: QRIS_IMAGE_PATH,
		paymentProofFolder: PAYMENT_PROOF_FOLDER
	});
	sock.ev.on('messages.upsert', onMessageUpsert);
}

startBot();