import 'dotenv/config'
import { connectDB } from './src/database/db.js'
import { connectRedis } from './src/utils/redis.js'
import { startBot } from './src/bot/index.js'
import { log } from './src/utils/logger.js'

async function main(): Promise<void> {
	await connectDB()
	await connectRedis()
	log('[BOT WORKER] Starting WhatsApp bot...')
	await startBot()
}

main().catch(err => {
	console.error('Fatal error:', err)
	process.exit(1)
})
