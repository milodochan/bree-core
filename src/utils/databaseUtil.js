import knex from 'knex'
import aes from './aesUtil.js'

let db = null

/** 解析 `key=value;key=value` 形式的连接串（值允许包含 `=`） */
const parseConnectionString = (str) =>
    str.split(';').reduce((acc, param) => {
        const idx = param.indexOf('=')
        if (idx === -1) return acc
        const key = param.slice(0, idx).trim()
        const value = param.slice(idx + 1).trim()
        if (key) acc[key] = value
        return acc
    }, {})

/** 配置了 DB_AES_KEY 时尝试解密；非密文（解密失败）则原样使用 */
const resolveConnectionString = (connectionString) => {
    const aesKey = process.env.DB_AES_KEY
    if (aesKey) {
        try {
            return aes.decryptString(connectionString, aesKey)
        } catch {
            // 明文连接串，直接使用
        }
    }
    return connectionString
}

class DatabaseHelper {
    /**
     * 初始化数据库连接（自动读取 DB_CONNECTION_STRING，可传参覆盖）
     * @param {string} [connectionString=process.env.DB_CONNECTION_STRING] 连接串（明文或 AES 密文）
     * @returns {Promise<object>} knex 实例
     * @example
     * const db = await database.init()
     * const rows = await db('users').select('*')
     */
    async init(connectionString = process.env.DB_CONNECTION_STRING) {
        if (!connectionString) {
            throw new Error(
                'DB connection string required: pass it to database.init(str) or set DB_CONNECTION_STRING'
            )
        }
        await this.close() // 重复初始化前先释放旧连接

        const params = parseConnectionString(resolveConnectionString(connectionString))
        db = knex({
            client: 'mssql',
            connection: {
                user: params.user,
                password: params.password,
                server: params.server,
                database: params.database,
                options: {
                    encrypt: false
                }
            }
        })

        try {
            await db.raw('SELECT 1') // 验证真实连接
        } catch (err) {
            await this.close()
            throw err
        }
        return db
    }

    /**
     * 获取 knex 实例（未初始化时给出明确提示）
     * @returns {object} knex 实例
     */
    get() {
        if (!db) throw new Error('Database not initialized, call await database.init() first')
        return db
    }

    /** 关闭数据库连接 */
    async close() {
        if (db) {
            await db.destroy()
            db = null
        }
    }
}

export default new DatabaseHelper()
