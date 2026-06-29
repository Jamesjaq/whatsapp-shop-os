import { WASocket, proto } from '../../../lib/index.js'
import { handleMessage, handleLocationMessage, handleImageMessage } from './flows.js'
import { ProcessedMessage } from '../models/ProcessedMessage.js'
import { phoneFromJid } from '../utils/jid.js'
import { log } from '../utils/logger.js'

export function setupMessageHandler(sock: WASocket): () => void {
		const handler = async ({ messages, type }: { messages: proto.IWebMessageInfo[]; type: string }) => {
			if (type !== 'notify') return

			for (const msg of messages) {
				if (!msg.key) continue
				if (msg.key.fromMe) continue
				if (!msg.message) continue

				const jid = msg.key.remoteJid
				if (!jid) continue

				if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue

				const isStandard = jid.endsWith('@s.whatsapp.net')
				const isLid = jid.endsWith('@lid')
				if (!isStandard && !isLid) continue

				const messageId = msg.key.id
			if (messageId) {
				try {
					await ProcessedMessage.create({ messageId, remoteJid: jid })
				} catch {
					continue
				}
			}

			const phone = phoneFromJid(jid)
			const sendFn = async (targetJid: string, message: string) => {
				await sock.sendMessage(targetJid, { text: message })
			}

			try {
				// ── WhatsApp Location Pin ──
				// When a buyer sends their location pin, extract coordinates
				const locationMsg = msg.message.locationMessage
				if (locationMsg && locationMsg.degreesLatitude != null && locationMsg.degreesLongitude != null) {
					log(`[MSG] ${jid} | location pin: ${locationMsg.degreesLatitude},${locationMsg.degreesLongitude}`)
					await handleLocationMessage(
						phone,
						jid,
						locationMsg.degreesLatitude,
						locationMsg.degreesLongitude,
						locationMsg.name ?? '',
						sendFn
					)
					continue
				}

				// ── Image Message (seller uploading product photo) ──
				const imageMsg = msg.message.imageMessage
				if (imageMsg) {
					const caption = imageMsg.caption ?? ''
					log(`[MSG] ${jid} | image message, caption="${caption}"`)
					// Attempt to download image buffer using Baileys Utils
					try {
						const { downloadContentFromMessage } = await import('../../../lib/Utils/messages-media.js')
						const stream = await downloadContentFromMessage(imageMsg as Parameters<typeof downloadContentFromMessage>[0], 'image')
						const chunks: Buffer[] = []
						for await (const chunk of stream) {
							chunks.push(chunk as Buffer)
						}
						const buffer = Buffer.concat(chunks)
						await handleImageMessage(phone, jid, buffer, caption, sendFn)
					} catch (imgErr) {
						log(`[MSG] ${jid} | image download failed: ${String(imgErr)}`)
						// Fall through to caption/text handling
						if (caption) {
							await handleMessage(phone, jid, caption, sendFn)
						} else {
							await handleMessage(phone, jid, '📸 image', sendFn)
						}
					}
					continue
				}

				// ── Standard text message ──
				const text = extractText(msg)
				if (!text) continue

				log(`[MSG] ${jid} | text="${text}"`)
				await handleMessage(phone, jid, text, sendFn)
			} catch (err) {
				log(`[ERROR] handleMessage failed for ${jid}: ${String(err)}`)
			}
		}
	}

	sock.ev.on('messages.upsert', handler)
	return () => sock.ev.off('messages.upsert', handler)
}

function extractText(msg: proto.IWebMessageInfo): string {
	const m = msg.message
	if (!m) return ''
	return (
		m.conversation ??
		m.extendedTextMessage?.text ??
		m.imageMessage?.caption ??
		m.videoMessage?.caption ??
		m.buttonsResponseMessage?.selectedDisplayText ??
		m.listResponseMessage?.title ??
		''
	)
}
