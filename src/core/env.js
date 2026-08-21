import dotenv from 'dotenv'
import path from 'node:path'

const mode = process.env.NODE_ENV || 'development'

// Vue 同款加载逻辑
const envFile = `.env.${mode}`

dotenv.config({
    path: path.resolve(process.cwd(), envFile),
    override: true
})

// 再加载公共 env（覆盖优先级最低）
dotenv.config({
    path: path.resolve(process.cwd(), '.env'),
    override: true
})

console.log(`[ENV] mode = ${mode}`)