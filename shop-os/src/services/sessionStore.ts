import { getRedis } from '../utils/redis.js'

export interface SessionState {
	step: string
	data: Record<string, string>
	lastActivity: number
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000
const KEY_PREFIX = 'shop-os:session:'

const memory = new Map<string, SessionState>()

export async function getSession(phone: string): Promise<SessionState> {
	const redis = getRedis()
	if (redis?.status === 'ready') {
		const raw = await redis.get(KEY_PREFIX + phone)
		if (raw) {
			const parsed = JSON.parse(raw) as SessionState
			if (Date.now() - parsed.lastActivity <= SESSION_TIMEOUT_MS) {
				parsed.lastActivity = Date.now()
				await redis.set(KEY_PREFIX + phone, JSON.stringify(parsed), 'PX', SESSION_TIMEOUT_MS)
				return parsed
			}
			await redis.del(KEY_PREFIX + phone)
		}
		const fresh: SessionState = { step: 'idle', data: {}, lastActivity: Date.now() }
		await redis.set(KEY_PREFIX + phone, JSON.stringify(fresh), 'PX', SESSION_TIMEOUT_MS)
		return fresh
	}

	const existing = memory.get(phone)
	if (existing && Date.now() - existing.lastActivity > SESSION_TIMEOUT_MS) {
		memory.delete(phone)
	}
	if (!memory.has(phone)) {
		memory.set(phone, { step: 'idle', data: {}, lastActivity: Date.now() })
	}
	const s = memory.get(phone)!
	s.lastActivity = Date.now()
	return s
}

export async function setSession(phone: string, state: Omit<SessionState, 'lastActivity'>): Promise<void> {
	const next: SessionState = { ...state, lastActivity: Date.now() }
	const redis = getRedis()
	if (redis?.status === 'ready') {
		await redis.set(KEY_PREFIX + phone, JSON.stringify(next), 'PX', SESSION_TIMEOUT_MS)
		return
	}
	memory.set(phone, next)
}

export async function resetSession(phone: string): Promise<void> {
	await setSession(phone, { step: 'idle', data: {} })
}
