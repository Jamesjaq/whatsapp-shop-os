import { jidDecode, jidNormalizedUser } from '../../../lib/WABinary/jid-utils.js'

export function phoneFromJid(jid: string): string {
	const decoded = jidDecode(jid)
	if (!decoded?.user) {
		return jid.replace(/@.+$/, '').replace(/:\d+$/, '')
	}
	return decoded.user.split(':')[0] ?? decoded.user
}

export function normalizeJid(jid: string): string {
	return jidNormalizedUser(jid) ?? jid
}

export function isLidJid(jid: string): boolean {
	return jid.endsWith('@lid') || jidDecode(jid)?.server === 'lid'
}

export function resolveOutboundJid(storedJid: string | undefined, phone: string): string {
	if (storedJid) return storedJid
	const digits = phone.replace(/\D/g, '')
	return `${digits}@s.whatsapp.net`
}

export function jidFromPhone(phone: string): string {
	const digits = phone.replace(/\D/g, '')
	return `${digits}@s.whatsapp.net`
}
