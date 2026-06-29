import 'dotenv/config'
import { connectDB } from './src/database/db.js'
import { connectRedis } from './src/utils/redis.js'
import { startPayoutCron } from './server.js'
import { log } from './src/utils/logger.js'

async function main(): Promise<void> {
	await connectDB()
	await connectRedis()
	log('[JOB WORKER] Starting background jobs...')
	await startPayoutCron()
}

main().catch(err => {
	console.error('Fatal error:', err)
	process.exit(1)
})
