import { verifyMpesaCallback } from '../services/mpesaIpnService.js'

describe('mpesaIpnService', () => {
	const original = process.env['MPESA_IPN_SECRET']

	afterEach(() => {
		if (original === undefined) delete process.env['MPESA_IPN_SECRET']
		else process.env['MPESA_IPN_SECRET'] = original
	})

	it('allows callback when secret not configured', () => {
		delete process.env['MPESA_IPN_SECRET']
		const req = { headers: {}, query: {} } as never
		expect(verifyMpesaCallback(req)).toBe(true)
	})

	it('rejects callback with wrong secret', () => {
		process.env['MPESA_IPN_SECRET'] = 'test-secret'
		const req = { headers: { 'x-mpesa-secret': 'wrong' }, query: {} } as never
		expect(verifyMpesaCallback(req)).toBe(false)
	})

	it('accepts callback with matching header secret', () => {
		process.env['MPESA_IPN_SECRET'] = 'test-secret'
		const req = { headers: { 'x-mpesa-secret': 'test-secret' }, query: {} } as never
		expect(verifyMpesaCallback(req)).toBe(true)
	})

	it('accepts callback with matching query secret', () => {
		process.env['MPESA_IPN_SECRET'] = 'test-secret'
		const req = { headers: {}, query: { secret: 'test-secret' } } as never
		expect(verifyMpesaCallback(req)).toBe(true)
	})
})
