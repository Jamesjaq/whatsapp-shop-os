import type { proto, WAMessageKey } from '../../../lib/index.js'
import { SentMessage } from '../models/SentMessage.js'

export async function storeSentMessage(key: WAMessageKey, text: string): Promise<void> {
	if (!key.id || !key.remoteJid) return
	await SentMessage.findOneAndUpdate(
		{ messageId: key.id },
		{ remoteJid: key.remoteJid, text, sentAt: new Date() },
		{ upsert: true }
	)
}

export async function getStoredMessage(
	key: WAMessageKey
): Promise<proto.IMessage | undefined> {
	if (!key.id) return undefined
	const stored = await SentMessage.findOne({ messageId: key.id })
	if (!stored?.text) return undefined
	return { conversation: stored.text }
}
