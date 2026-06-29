import { isPaymentReadyForSellerConfirm } from '../services/paymentService.js'

describe('paymentService gates', () => {
	it('allows seller confirm when order is paid', () => {
		expect(isPaymentReadyForSellerConfirm('pending', 'paid')).toBe(true)
	})

	it('allows seller confirm when ref submitted', () => {
		expect(isPaymentReadyForSellerConfirm('ref_submitted', 'pending')).toBe(true)
	})

	it('blocks seller confirm when payment still pending', () => {
		expect(isPaymentReadyForSellerConfirm('pending', 'pending')).toBe(false)
	})

	it('allows seller confirm when payment confirmed', () => {
		expect(isPaymentReadyForSellerConfirm('confirmed', 'pending')).toBe(true)
	})
})
