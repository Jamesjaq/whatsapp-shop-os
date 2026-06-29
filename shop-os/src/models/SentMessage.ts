import mongoose, { Document, Schema } from 'mongoose'

export interface ISentMessage extends Document {
	messageId: string
	remoteJid: string
	text: string
	sentAt: Date
}

const SentMessageSchema = new Schema<ISentMessage>({
	messageId: { type: String, required: true, unique: true, index: true },
	remoteJid: { type: String, required: true, index: true },
	text: { type: String, default: '' },
	sentAt: { type: Date, default: Date.now, expires: 604800 },
})

export const SentMessage = mongoose.model<ISentMessage>('SentMessage', SentMessageSchema)
