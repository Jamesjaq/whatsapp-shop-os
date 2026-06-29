import { Queue, Worker } from 'bullmq'
import { getRedisUrl } from '../utils/redis.js'
import { log } from '../utils/logger.js'

type SendFn = (jid: string, text: string) => Promise<void>

export interface OutboundJob {
	jid: string
	text: string
	orderId?: string
	idempotencyKey?: string
}

let queue: Queue<OutboundJob> | null = null
let worker: Worker<OutboundJob> | null = null
let directSend: SendFn | null = null
const deadLetter: OutboundJob[] = []

function connectionOpts() {
	const url = getRedisUrl()
	if (!url) return null
	return { url }
}

export function registerDirectSend(fn: SendFn): void {
	directSend = fn
}

export async function startOutboundWorker(send: SendFn): Promise<void> {
	registerDirectSend(send)
	const conn = connectionOpts()
	if (!conn) return

	if (worker) return

	worker = new Worker<OutboundJob>(
		'shop-os-notify',
		async job => {
			await send(job.data.jid, job.data.text)
		},
		{
			connection: conn,
			concurrency: 5,
		}
	)

	worker.on('failed', (job, err) => {
		if (job) {
			deadLetter.push(job.data)
			log(`[NOTIFY QUEUE] Dead letter jid=${job.data.jid} err=${String(err)}`)
		}
	})

	log('[NOTIFY QUEUE] Worker started')
}

function getQueue(): Queue<OutboundJob> | null {
	const conn = connectionOpts()
	if (!conn) return null
	if (!queue) {
		queue = new Queue<OutboundJob>('shop-os-notify', { connection: conn })
	}
	return queue
}

export async function enqueueNotify(job: OutboundJob): Promise<void> {
	const q = getQueue()
	if (q && directSend) {
		await q.add('notify', job, {
			removeOnComplete: 100,
			removeOnFail: 50,
			attempts: 5,
			backoff: { type: 'exponential', delay: 2000 },
			jobId: job.idempotencyKey,
		})
		return
	}

	if (!directSend) {
		log(`[NOTIFY] Dropped — socket not ready jid=${job.jid}`)
		deadLetter.push(job)
		return
	}

	try {
		await directSend(job.jid, job.text)
	} catch (err) {
		log(`[NOTIFY] Direct send failed jid=${job.jid}: ${String(err)}`)
		deadLetter.push(job)
	}
}

export function getDeadLetterQueue(): OutboundJob[] {
	return [...deadLetter]
}

export async function shutdownOutboundQueue(): Promise<void> {
	await worker?.close()
	await queue?.close()
	worker = null
	queue = null
}
