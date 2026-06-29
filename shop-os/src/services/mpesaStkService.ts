import { log } from '../utils/logger.js'
import { toInternationalPhone } from '../utils/phone.js'
import { markAwaitingStk } from './paymentService.js'

const DARAJA_BASE = process.env['MPESA_ENV'] === 'production'
	? 'https://api.safaricom.co.ke'
	: 'https://sandbox.safaricom.co.ke'

function stkConfigured(): boolean {
	return Boolean(
		process.env['MPESA_CONSUMER_KEY'] &&
			process.env['MPESA_CONSUMER_SECRET'] &&
			process.env['MPESA_PASSKEY'] &&
			process.env['MPESA_SHORTCODE'] &&
			process.env['MPESA_CALLBACK_URL']
	)
}

async function getAccessToken(): Promise<string> {
	const key = process.env['MPESA_CONSUMER_KEY']!
	const secret = process.env['MPESA_CONSUMER_SECRET']!
	const auth = Buffer.from(`${key}:${secret}`).toString('base64')
	const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
		headers: { Authorization: `Basic ${auth}` },
	})
	if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`)
	const data = (await res.json()) as { access_token: string }
	return data.access_token
}

export function isStkConfigured(): boolean {
	return stkConfigured()
}

export async function initiateStkPush(
	orderId: string,
	phone: string,
	amount: number
): Promise<{ ok: boolean; checkoutRequestId?: string; error?: string }> {
	if (!stkConfigured()) {
		return { ok: false, error: 'STK not configured' }
	}

	try {
		const token = await getAccessToken()
		const shortcode = process.env['MPESA_SHORTCODE']!
		const passkey = process.env['MPESA_PASSKEY']!
		const callbackUrl = process.env['MPESA_CALLBACK_URL']!
		const timestamp = new Date()
			.toISOString()
			.replace(/[-:TZ.]/g, '')
			.slice(0, 14)
		const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
		const intPhone = toInternationalPhone(phone)

		const body = {
			BusinessShortCode: shortcode,
			Password: password,
			Timestamp: timestamp,
			TransactionType: 'CustomerPayBillOnline',
			Amount: Math.ceil(amount),
			PartyA: intPhone,
			PartyB: shortcode,
			PhoneNumber: intPhone,
			CallBackURL: callbackUrl,
			AccountReference: orderId.slice(0, 12),
			TransactionDesc: `Shop OS ${orderId}`,
		}

		const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		})

		const data = (await res.json()) as {
			ResponseCode?: string
			ResponseDescription?: string
			CheckoutRequestID?: string
			errorMessage?: string
		}

		if (data.ResponseCode !== '0' || !data.CheckoutRequestID) {
			log(`[STK] Failed for ${orderId}: ${data.errorMessage ?? data.ResponseDescription ?? res.status}`)
			return { ok: false, error: data.errorMessage ?? data.ResponseDescription ?? 'STK failed' }
		}

		await markAwaitingStk(orderId, data.CheckoutRequestID)
		log(`[STK] Initiated for order ${orderId} checkout=${data.CheckoutRequestID}`)
		return { ok: true, checkoutRequestId: data.CheckoutRequestID }
	} catch (err) {
		log(`[STK ERROR] ${String(err)}`)
		return { ok: false, error: String(err) }
	}
}
