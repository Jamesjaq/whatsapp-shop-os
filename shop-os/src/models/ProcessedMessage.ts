import mongoose, { Document, Schema } from 'mongoose'

export interface IProcessedMessage extends Document {
	messageId: string
	remoteJid: string
	processedAt: Date
}

const ProcessedMessageSchema = new Schema<IProcessedMessage>({
	messageId: { type: String, required: true, unique: true, index: true },
	remoteJid: { type: String, required: true },
	processedAt: { type: Date, default: Date.now, expires: 86400 },
})

export const ProcessedMessage = mongoose.model<IProcessedMessage>('ProcessedMessage', ProcessedMessageSchema)
