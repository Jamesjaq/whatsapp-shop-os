import { Redis } from 'ioredis'
import { log } from './logger.js'

let client: Redis | null = null

export function getRedisUrl(): string | undefined {
	return process.env['REDIS_URL']
}

export function getRedis(): Redis | null {
	if (!getRedisUrl()) return null
	if (!client) {
		client = new Redis(getRedisUrl()!, {
			maxRetriesPerRequest: null,
			lazyConnect: true,
		})
		client.on('error', err => log(`[REDIS ERROR] ${String(err)}`))
	}
	return client
}

export async function connectRedis(): Promise<Redis | null> {
	const redis = getRedis()
	if (!redis) return null
	if (redis.status === 'ready') return redis
	await redis.connect()
	log('[REDIS] Connected')
	return redis
}

export async function disconnectRedis(): Promise<void> {
	if (client) {
		await client.quit()
		client = null
	}
}
