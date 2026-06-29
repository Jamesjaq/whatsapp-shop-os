import crypto from 'crypto'
import type { Request } from 'express'

const COOKIE_NAME = 'admin_session'

function getSecret(): string {
	const secret = process.env['ADMIN_DASHBOARD_SECRET']
	if (!secret) {
		throw new Error('ADMIN_DASHBOARD_SECRET is required. Set it in .env before starting the server.')
	}
	return secret
}

function signToken(): string {
	return crypto.createHmac('sha256', getSecret()).update('shop-os-admin-v1').digest('hex')
}

export function createAdminSessionCookie(): string {
	return `${COOKIE_NAME}=${signToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
}

export function isValidAdminSession(req: Request): boolean {
	const cookieHeader = req.headers.cookie
	if (!cookieHeader) return false
	const cookies = cookieHeader.split(';').reduce(
		(acc, c) => {
			const [key, ...val] = c.trim().split('=')
			acc[key] = val.join('=')
			return acc
		},
		{} as Record<string, string>
	)
	const session = cookies[COOKIE_NAME]
	if (!session) return false
	try {
		return crypto.timingSafeEqual(Buffer.from(session), Buffer.from(signToken()))
	} catch {
		return false
	}
}

export function verifyAdminPassword(password: string): boolean {
	const secret = getSecret()
	try {
		return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(secret))
	} catch {
		return false
	}
}
