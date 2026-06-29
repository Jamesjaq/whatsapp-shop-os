import 'dotenv/config'
import { connectDB } from './src/database/db.js'
import { connectRedis } from './src/utils/redis.js'
import { shopOsApp } from './server.js'
import { log } from './src/utils/logger.js'

const PORT = parseInt(process.env['PORT'] ?? '3001')

async function main(): Promise<void> {
	await connectDB()
	await connectRedis()
	log('[API] Database connected')

	shopOsApp.listen(PORT, '0.0.0.0', () => {
		log(`[API] Admin API running on http://localhost:${PORT}`)
	})
}

main().catch(err => {
	console.error('Fatal error:', err)
	process.exit(1)
})
