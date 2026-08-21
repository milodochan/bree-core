import { useDatabase } from '../core/useDatabase.js'
import dotenv from 'dotenv'
dotenv.config()

const db = useDatabase()
const init = async () => await db.init(process.env.DB_CONNECTION_STRING)
const close = async () => await db.close()

export default {
    init,
    close
}