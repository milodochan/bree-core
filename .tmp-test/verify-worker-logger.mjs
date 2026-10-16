// 验证：worker 线程内 createLogger({name:'weixinapi'}) 应走代理，postMessage 回主线程（不自己写文件）
import { Worker } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.js')).href
const workerCode = `
import { createLogger } from ${JSON.stringify(distUrl)}
const log = createLogger({ name: 'weixinapi' })
log.info('test-weixin-msg')
log.error(new Error('test-weixin-err'))
`

const w = new Worker(workerCode, { eval: true })
let got = []
w.on('message', (m) => {
  got.push(m)
  console.log('MAIN received:', JSON.stringify(m))
})
w.on('exit', () => {
  const named = got.filter(m => m.type === 'log' && m.name === 'weixinapi')
  console.log('\n=== RESULT ===')
  console.log('received log msgs with name=weixinapi:', named.length)
  console.log('levels:', named.map(m => m.level).join(','))
  if (named.length === 2 && named.every(m => Array.isArray(m.args))) {
    console.log('PASS: worker proxy posts name + args correctly')
  } else {
    console.log('FAIL')
  }
  process.exit(0)
})
