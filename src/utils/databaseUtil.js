import knex from 'knex'
import aes from './aesUtil.js'

/** 解析 key=value;key=value 形式的连接串 */
const parseConnectionString = (str) =>
    str.split(';').reduce((acc, param) => {
        const idx = param.indexOf('=')
        if (idx === -1) return acc
        const key = param.slice(0, idx).trim()
        const value = param.slice(idx + 1).trim()
        if (key) acc[key] = value
        return acc
    }, {})

/** 配置了 DB_AES_KEY 时尝试解密 */
const resolveConnectionString = (connectionString) => {
    const aesKey = process.env.DB_AES_KEY
    if (aesKey) {
        try {
            return aes.decryptString(connectionString, aesKey)
        } catch {
            // 解密失败，认为是明文
        }
    }

    return connectionString
}
/**
 * 创建数据库实例
 */
export const useDatabase = async (connectionString = process.env.DB_CONNECTION_STRING) => {
    if (!connectionString)
        throw new Error('DB connection string required: pass it to init(str) or set DB_CONNECTION_STRING')

    // 当前实例重复初始化
    const params = parseConnectionString(resolveConnectionString(connectionString))
    const db = knex({
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

    const close = async () => await db.destroy()

    return {
        db,
        close
    }
}