import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongod: MongoMemoryServer | null = null

export async function connectDB(): Promise<void> {
	const uri = process.env['MONGODB_URI']
	const isProd = process.env['NODE_ENV'] === 'production'

	if (isProd && !uri) {
		throw new Error('MONGODB_URI is required in production. In-memory MongoDB is not allowed.')
	}

	if (uri) {
		await mongoose.connect(uri)
		console.log('[DB] Connected to MongoDB')
	} else {
		mongod = await MongoMemoryServer.create()
		const memUri = mongod.getUri()
		await mongoose.connect(memUri)
		console.log('[DB] Using in-memory MongoDB (development mode)')
		console.log('[DB] Set MONGODB_URI in .env to use a real database')
	}
}

export async function disconnectDB(): Promise<void> {
	await mongoose.disconnect()
	if (mongod) {
		await mongod.stop()
	}
}
