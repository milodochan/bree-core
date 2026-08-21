import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

export default {
    input: './src/index.js',
    output: {
        file: './dist/index.js',
        format: 'es',
        sourcemap: true
    },
    plugins: [
        resolve(),
        commonjs()
    ],
    external: [
        'bree',
        'knex',
        'mssql',
        'redis',
        'exceljs',
        'nodemailer',
        'winston',
        'winston-daily-rotate-file',
        'dotenv'
    ]
}