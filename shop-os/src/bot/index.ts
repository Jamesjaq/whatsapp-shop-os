import makeWASocket, {
	DisconnectReason,
	fetchLatestBaileysVersion,
	useMultiFileAuthState,
	DEFAULT_CONNECTION_CONFIG,
	makeCacheableSignalKeyStore,
	type CacheStore,
	type WASocket,
} from '../../../lib/index.js'
import NodeCache from '@cacheable/node-cache'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import P from 'pino'
import { setupMessageHandler } from './messageHandler.js'
import { registerNotifier, registerMessageCapture } from './notifier.js'
import { startOutboundWorker } from '../services/outboundQueue.js'
import { getStoredMessage, storeSentMessage } from '../utils/messageStore.js'
import { log } from '../utils/logger.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.resolve(__dirname, '../../../.auth')

const logger = P({ level: process.env['BOT_LOG_LEVEL'] ?? 'warn' })
const msgRetryCounterCache = new NodeCache() as CacheStore

let connecting = false
let currentSock: WASocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let messageHandlerCleanup: (() => void) | null = null

export async function startBot(): Promise<void> {
	log('[BOT] Starting WhatsApp Shop OS...')

	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
	const { version, isLatest } = await fetchLatestBaileysVersion()
	log(`[BOT] Baileys version: ${version.join('.')}${isLatest ? ' (latest)' : ''}`)

	await connect(state, saveCreds, version as [number, number, number])
}

async function connect(
	state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'],
	saveCreds: () => Promise<void>,
	version: [number, number, number]
): Promise<void> {
	if (connecting) return
	connecting = true

	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}

	if (currentSock) {
		messageHandlerCleanup?.()
		messageHandlerCleanup = null
		currentSock.ev.removeAllListeners('connection.update')
		currentSock.ev.removeAllListeners('creds.update')
		try {
			currentSock.end(undefined)
		} catch {
			/* socket may already be closed */
		}
		currentSock = null
	}

	const sock = makeWASocket({
		...DEFAULT_CONNECTION_CONFIG,
		version,
		logger,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		getMessage: async key => getStoredMessage(key),
		browser: ['WhatsApp Shop OS', 'Chrome', '1.0.0'],
	})

	currentSock = sock
	messageHandlerCleanup = setupMessageHandler(sock)

	sock.ev.on('creds.update', saveCreds)

	sock.ev.on('connection.update', update => {
		const { connection, lastDisconnect, qr } = update

		if (qr) {
			log('[BOT] QR code generated — scan with WhatsApp to connect')
			console.log('\n📱 Scan this QR code with WhatsApp (Linked Devices → Link a Device):\n')
			qrcode.generate(qr, { small: true })
		}

		if (connection === 'close') {
			const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
			const shouldReconnect = statusCode !== DisconnectReason.loggedOut
			log(`[BOT] Connection closed. Reconnect: ${shouldReconnect}`)
			connecting = false
			if (shouldReconnect) {
				reconnectTimer = setTimeout(() => {
					void connect(state, saveCreds, version)
				}, 3000)
			} else {
				log('[BOT] Logged out. Delete .auth/ folder and restart to re-scan QR.')
			}
		}

		if (connection === 'open') {
			connecting = false
			log('[BOT] WhatsApp connected! Shop OS is live.')
			console.log('\n✅ WhatsApp Shop OS is running! Ready to receive orders.\n')

			const sendFn = async (jid: string, text: string) => {
				const sent = await sock.sendMessage(jid, { text })
				if (sent?.key) await storeSentMessage(sent.key, text)
			}

			registerNotifier(sendFn)
			registerMessageCapture(sendFn)
			void startOutboundWorker(sendFn)
		}
	})
}

export function getBotSocket(): WASocket | null {
	return currentSock
}
