import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logFile = path.resolve(__dirname, '../../../logs/shop-os.log')

fs.mkdirSync(path.dirname(logFile), { recursive: true })

export function log(message: string): void {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}`
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
}
