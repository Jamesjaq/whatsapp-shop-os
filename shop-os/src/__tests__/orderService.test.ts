import { isPaymentReadyForSellerConfirm } from '../services/paymentService.js'

describe('orderService confirm gate', () => {
	it('blocks M-Pesa orders until ref submitted or paid', () => {
		const orderPaymentStatus = 'pending'
		const paymentStatus = 'pending'
		const ready = orderPaymentStatus === 'paid' || isPaymentReadyForSellerConfirm(paymentStatus, orderPaymentStatus)
		expect(ready).toBe(false)
	})

	it('allows M-Pesa orders after buyer submits ref', () => {
		const orderPaymentStatus = 'pending'
		const paymentStatus = 'ref_submitted'
		const ready = orderPaymentStatus === 'paid' || isPaymentReadyForSellerConfirm(paymentStatus, orderPaymentStatus)
		expect(ready).toBe(true)
	})
})
