/** Normalize Kenyan phone numbers to comparable digit forms. */
export function normalizePhoneDigits(phone: string): string {
	const digits = phone.replace(/\D/g, '')
	if (digits.startsWith('254') && digits.length >= 12) {
		return digits.slice(3)
	}
	if (digits.startsWith('0') && digits.length >= 10) {
		return digits.slice(1)
	}
	return digits
}

export function toInternationalPhone(phone: string): string {
	const local = normalizePhoneDigits(phone)
	if (local.length === 9) return `254${local}`
	return phone.replace(/\D/g, '')
}

export function phonesMatch(a: string, b: string): boolean {
	const da = normalizePhoneDigits(a)
	const db = normalizePhoneDigits(b)
	return da.length > 0 && da === db
}
