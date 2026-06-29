import { enqueueNotify } from '../services/outboundQueue.js'
export { jidFromPhone, resolveOutboundJid } from '../utils/jid.js'

type SendFn = (jid: string, text: string) => Promise<void>

let _send: SendFn | null = null

export function registerNotifier(fn: SendFn): void {
	_send = fn
}

export function registerMessageCapture(fn: SendFn): void {
	_send = fn
}

export async function notify(jid: string, text: string, orderId?: string): Promise<void> {
	await enqueueNotify({
		jid,
		text,
		orderId,
		idempotencyKey: orderId ? `${orderId}:${text.slice(0, 32)}` : undefined,
	})
}

export async function notifyDirect(jid: string, text: string): Promise<void> {
	if (!_send) {
		await enqueueNotify({ jid, text })
		return
	}
	try {
		await _send(jid, text)
	} catch (err) {
		console.error(`[NOTIFY] Failed to send to ${jid}:`, err)
		await enqueueNotify({ jid, text })
	}
}
