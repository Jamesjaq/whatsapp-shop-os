import { phoneFromJid, normalizeJid, jidFromPhone, resolveOutboundJid } from '../utils/jid.js'
import { normalizePhoneDigits, phonesMatch, toInternationalPhone } from '../utils/phone.js'

describe('phone utils', () => {
	it('normalizes Kenyan international numbers', () => {
		expect(normalizePhoneDigits('254712345678')).toBe('712345678')
		expect(normalizePhoneDigits('0712345678')).toBe('712345678')
	})

	it('matches equivalent phone formats', () => {
		expect(phonesMatch('254712345678', '0712345678')).toBe(true)
		expect(phonesMatch('712345678', '254712345678')).toBe(true)
	})

	it('formats to international', () => {
		expect(toInternationalPhone('0712345678')).toBe('254712345678')
	})
})

describe('jid utils', () => {
	it('extracts phone from standard JID', () => {
		expect(phoneFromJid('254712345678@s.whatsapp.net')).toBe('254712345678')
	})

	it('extracts phone from device-suffixed JID', () => {
		expect(phoneFromJid('254712345678:0@s.whatsapp.net')).toBe('254712345678')
	})

	it('normalizes JID', () => {
		expect(normalizeJid('254712345678:0@s.whatsapp.net')).toContain('254712345678')
	})

	it('prefers stored JID for outbound', () => {
		expect(resolveOutboundJid('12345@lid', '254712345678')).toBe('12345@lid')
		expect(resolveOutboundJid('', '254712345678')).toBe('254712345678@s.whatsapp.net')
	})

	it('builds PN JID from phone', () => {
		expect(jidFromPhone('254712345678')).toBe('254712345678@s.whatsapp.net')
	})
})
