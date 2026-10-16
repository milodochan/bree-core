import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { records } from './tmp-knex-stub.mjs'
import { useDatabase, closeDatabase } from '../src/utils/databaseUtil.js'

let failed = 0
const check = (name, ok) => {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

const SAME = 'user=u;password=p;server=s;database=main'
process.env.DB_CONNECTION_STRING = SAME

const a = await useDatabase()
const b = await useDatabase(SAME)
check('主线程：同一连接串复用同一个池', a.db === b.db)
check('主线程：默认串保活 min=2 max=10', a.db.config.pool.min === 2 && a.db.config.pool.max === 10)
check('主线程：预热只做一次', records[0].prewarm === 1)

await a.close()
await b.close()
check('主线程：close() 不销毁池', records[0].destroyed === false)

const c = await useDatabase('user=u;password=p;server=s;database=other')
check('主线程：非默认串不保活 min=0', c.db.config.pool.min === 0)
check('主线程：非默认串各自独立池', records.length === 2)

await c.close()
check('主线程：非默认串 close() 后仍常驻', records[1].destroyed === false)

await closeDatabase()
check('主线程：closeDatabase() 收掉全部池', records[0].destroyed && records[1].destroyed)

const d = await useDatabase()
check('主线程：closeDatabase() 之后仍可重新取池', records.length === 3 && d.db.config.pool === records[2].pool)

const worker = new Worker(new URL('./tmp-worker.mjs', import.meta.url))
const results = await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => reject(new Error(`worker 提前退出: ${code}`)))
})
for (const [name, ok] of results) check(name, ok)
await worker.terminate()

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
