import knex from 'knex'
import dotenv from 'dotenv'
import aes from '../utils/aesUtil.js'
dotenv.config()

export function useDatabase() {
    let db = null

    const init = async (connectionString) => {
        const aesKey = process.env.DB_AES_KEY
        try {
            const decryptedConnectionString = aes.decryptString(connectionString, aesKey)
            const connectionParams = decryptedConnectionString.split(';').reduce((acc, param) => {
                const [key, value] = param.split('=')
                acc[key] = value
                return acc
            }, {})
            db = knex({
                client: 'mssql',
                connection: {
                    user: connectionParams.user,
                    password: connectionParams.password,
                    server: connectionParams.server,
                    database: connectionParams.database,
                    options: {
                        encrypt: false
                    }
                }
            })

            // 等待数据库真实连接
            await db.raw('SELECT 1')
            console.log('database initialized')
            return db
        } catch (error) {
            await close()

            throw error
        }
    }

    const close = async () => {
        if (db) {
            await db.destroy()
            db = null
        }
    }

    return { init, close }
}