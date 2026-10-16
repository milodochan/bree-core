import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parentPort } from 'node:worker_threads'

// 必须在动态 import 之前注册，才能让 knex 解析到 stub
register('./tmp-loader.mjs', pathToFileURL('./.tmp-test/'))

const { records } = await import('./tmp-knex-stub.mjs')
const { useDatabase, closeDatabase } = await import('../src/utils/databaseUtil.js')

const results = []
const check = (name, ok) => results.push([name, ok])

try {
    const s1 = 'user=u;password=p;server=s;database=workerA'
    const s2 = 'user=u;password=p;server=s;database=workerB'

    const a = await useDatabase(s1)
    const b = await useDatabase(s1)
    check('worker：同一连接串复用同一个池', a.db === b.db)
    check('worker：池配置 min=0 max=5（用完即毁，不保活）', a.db.config.pool.min === 0 && a.db.config.pool.max === 5)
    check('worker：预热只做一次', records[0].prewarm === 1)

    await a.close()
    check('worker：引用未归零不销毁', records[0].destroyed === false)

    await b.close()
    check('worker：引用归零即销毁', records[0].destroyed === true)

    const c = await useDatabase(s2)
    check('worker：不同连接串各自独立池', records.length === 2 && c.db.config.pool === records[1].pool)

    const d = await useDatabase(s1)
    check('worker：已销毁的连接串重新取会新建池', records.length === 3 && d.db.config.pool === records[2].pool)

    await closeDatabase()
    check('worker：closeDatabase() 收掉线程内所有池', records[1].destroyed && records[2].destroyed)
} catch (error) {
    check(`worker 执行异常: ${error?.stack || error}`, false)
}

parentPort.postMessage(results)
