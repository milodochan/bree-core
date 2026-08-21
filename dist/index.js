import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { createClient } from 'redis';
import Bree from 'bree';
import fs$1 from 'node:fs';
import { fileURLToPath } from 'node:url';
import winston from 'winston';
import 'winston-daily-rotate-file';
import knex from 'knex';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

let baseFolder = null;

/**
 * 内部：构建 sheet columns:[{ header: 'ID', key: 'id', width: 10 }]
 */
const buildSheet = (workbook, columns, data) => {
    const sheet = workbook.addWorksheet('sheet1');
    sheet.columns = columns;
    for (const item of data) {
        sheet.addRow(item);
    }
    return sheet
};

/**
 * 文件
 * @param {*} fileName 
 * @param {*} folder 
 * @returns 
 */
const getFilePath = async (fileName) => {
    const baseDir = baseFolder
        ? path.resolve(process.cwd(), baseFolder)
        : process.cwd();

    await fs.mkdir(baseDir, { recursive: true });

    const name = fileName.endsWith('.xlsx')
        ? fileName
        : `${fileName}.xlsx`;

    return path.join(baseDir, name)
};

/**
 * 设置基础目录
 * @param {*} folder 
 */
const setFolder = (folder) => {
    baseFolder = folder;
};

/**
 * 小/中数据：生成 Excel 文件（落盘）
 * 适合：< 5w 行
 */
const createExcel = async (columns, data, fileName = 'report') => {
    const workbook = new ExcelJS.Workbook();
    buildSheet(workbook, columns, data);
    const filePath = await getFilePath(fileName);
    await workbook.xlsx.writeFile(filePath);
    return filePath
};

/**
 * 邮件专用：生成 Buffer（不落盘）
 * 适合：中小数据
 */
const createBufferExcel = async (columns, data) => {
    const workbook = new ExcelJS.Workbook();
    buildSheet(workbook, columns, data);
    return await workbook.xlsx.writeBuffer()
};

/**
 * 大数据（核心优化）：流式写入（不爆内存）
 * 适合：10w ~ 100w+
 */
let streamWorkbook = null;
let streamSheet = null;
const createStreamExcel = async (columns, data, fileName = 'report', lastWrite = false) => {
    const filePath = await getFilePath(fileName);
    if (!streamWorkbook) {
        streamWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            filename: filePath,
            useStyles: false,
            useSharedStrings: true
        });

        streamSheet = workbook.addWorksheet('Report');
        streamSheet.columns = columns;
    }
    for (const item of data) {
        streamSheet.addRow(item).commit();
    }

    if (lastWrite) {
        await workbook.commit();
        streamWorkbook = null;
        streamSheet = null;
    }
    return filePath
};

/**
 * 🚀 统一入口（推荐用这个）
 */
const exportExcel = async ({
    mode = 'file', // file | buffer | stream
    columns,
    data,
    fileName = 'report'
}) => {
    switch (mode) {
        case 'buffer':
            return await createBufferExcel(columns, data)
        case 'stream':
            return await createStreamExcel(columns, data, fileName, true)
        default:
            return await createExcel(columns, data, fileName)
    }
};

var excelUtil = {
    setFolder,
    getFilePath,
    exportExcel,
    createExcel,
    createBufferExcel,
    createStreamExcel
};

let transporter = null;
let from = '';
const init$2 = () => {
    from = `"${process.env.MAIL_USERNAME}" <${process.env.MAIL_ACCOUNT}>`;
    transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST, // 或公司邮箱 SMTP
        port: Number(process.env.MAIL_PORT),
        secure: true,
        auth: {
            user: process.env.MAIL_ACCOUNT,
            pass: process.env.MAIL_PASSWORD // 注意不是密码
        }
    });
};

const send = async (subject, toUser = '', copyUser = '', content = '', filePath = []) => {
    await transporter.sendMail({
        from: from,
        to: toUser.split(',').map(i => i.trim()).filter(Boolean),
        cc: copyUser.split(',').map(i => i.trim()).filter(Boolean),
        subject: subject,
        text: content,
        attachments: filePath.map(file => {
            const filename = path.basename(file); // ⭐ 核心：自动截取文件名
            return {
                path: file,
                filename
            }
        })
    });
};

var mailUtil = {
    init: init$2,
    send
};

let client = null;

async function createRedisClient() {
    const redis = createClient({
        socket: {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
            reconnectStrategy(retries) {
                console.log(`Redis 重连 ${retries}`);

                // 超过 2 次停止重连
                if (retries > 3) {
                    return new Error('Redis 重连失败')
                }

                return Math.min(retries * 1000, 5000)
            }
        },
        RESP: 2,   // ⭐关键
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        database: Number(process.env.REDIS_DB || 0)
    });

    redis.on('connect', () => {
        console.log('Redis 正在连接...');
    });

    redis.on('ready', () => {
        console.log('Redis 已连接');
    });

    redis.on('reconnecting', () => {
        console.log('Redis 重连中...');
    });

    redis.on('end', () => {
        console.log('Redis 已断开');
    });

    redis.on('error', (err) => {
        console.error('Redis异常:', err.message);
    });

    await redis.connect();

    return redis
}

async function getRedis() {
    if (!client) {
        client = await createRedisClient();
    }

    return client
}

async function closeRedis() {
    if (client) {
        await client.quit();
        client = null;
    }
}

class RedisHelper {
    async set(key, value, expireSeconds = null) {
        const redis = await getRedis();

        const data =
            typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);

        if (expireSeconds) {
            return await redis.set(key, data, {
                EX: expireSeconds
            })
        }

        return await redis.set(key, data)
    }

    async get(key) {
        const redis = await getRedis();

        const value = await redis.get(key);

        if (!value) return null

        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    async del(key) {
        const redis = await getRedis();
        return await redis.del(key)
    }

    async exists(key) {
        const redis = await getRedis();
        return (await redis.exists(key)) === 1
    }

    async expire(key, seconds) {
        const redis = await getRedis();
        return await redis.expire(key, seconds)
    }

    async ttl(key) {
        const redis = await getRedis();
        return await redis.ttl(key)
    }

    async incr(key) {
        const redis = await getRedis();
        return await redis.incr(key)
    }

    async decr(key) {
        const redis = await getRedis();
        return await redis.decr(key)
    }

    async hSet(key, field, value) {
        const redis = await getRedis();

        return await redis.hSet(
            key,
            field,
            typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)
        )
    }

    async hGet(key, field) {
        const redis = await getRedis();

        const value = await redis.hGet(key, field);

        if (!value) return null

        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    async hGetAll(key) {
        const redis = await getRedis();
        return await redis.hGetAll(key)
    }

    async lPush(key, value) {
        const redis = await getRedis();

        return await redis.lPush(
            key,
            JSON.stringify(value)
        )
    }

    async rPush(key, value) {
        const redis = await getRedis();

        return await redis.rPush(
            key,
            JSON.stringify(value)
        )
    }

    async rPop(key) {
        const redis = await getRedis();

        const value = await redis.rPop(key);

        return value
            ? JSON.parse(value)
            : null
    }

    async lPop(key) {
        const redis = await getRedis();

        const value = await redis.lPop(key);

        return value
            ? JSON.parse(value)
            : null
    }

    async close() {
        await closeRedis();
    }
}

var redis = new RedisHelper();

const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);

const { combine: combine$2, timestamp: timestamp$2, printf: printf$2 } = winston.format;
const logFormat$2 = printf$2(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
});

const breeLogger = winston.createLogger({
    level: 'info',
    format: combine$2(
        timestamp$2({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat$2
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'worker-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
});

/**
 * worker日志
 */
const worker = (jobName, message) => {
    breeLogger.info(`[${jobName}] ${message}`);
};

/**
 * error日志
 */
const error$1 = (jobName, err) => {
    breeLogger.error(`[${jobName}] ${err?.stack || err?.message || err}`);
};
var blogger = { worker, error: error$1 };

const ALGORITHM_MAP$1 = {
    16: 'aes-128-ecb',
    24: 'aes-192-ecb',
    32: 'aes-256-ecb'
};

const encrypt$1 = (data, key) => {
    // key 必须 16 / 24 / 32 字节
    const keyBuf = Buffer.from(key, 'utf8');
    const cipher = crypto.createCipheriv(ALGORITHM_MAP$1[keyBuf.length], keyBuf, null);
    cipher.setAutoPadding(true); // PKCS7
    const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final()
    ]);
    return encrypted
};

const decrypt$1 = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8');
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP$1[keyBuf.length], keyBuf, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final()
    ]);
    return decrypted
};

/**
 * AES解密
 * 对应 Java:
 * AesUtil.decrypt(String data, String key)
 *
 * @param {string} data Base64密文
 * @param {string} key AES密钥(16/24/32字节)
 * @returns {string} 明文
 */
const decryptString$1 = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8');
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP$1[keyBuf.length], keyBuf, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final()
    ]);
    return decrypted.toString('utf8')
};

var aes$1 = { encrypt: encrypt$1, decrypt: decrypt$1, decryptString: decryptString$1 };

dotenv.config();

function useDatabase() {
    let db = null;

    const init = async (connectionString) => {
        const aesKey = process.env.DB_AES_KEY;
        try {
            const decryptedConnectionString = aes$1.decryptString(connectionString, aesKey);
            const connectionParams = decryptedConnectionString.split(';').reduce((acc, param) => {
                const [key, value] = param.split('=');
                acc[key] = value;
                return acc
            }, {});
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
            });

            // 等待数据库真实连接
            await db.raw('SELECT 1');
            console.log('database initialized');
            return db
        } catch (error) {
            await close();

            throw error
        }
    };

    const close = async () => {
        if (db) {
            await db.destroy();
            db = null;
        }
    };

    return { init, close }
}

dotenv.config();

const db$1 = useDatabase();
const init$1 = async () => await db$1.init(process.env.DB_CONNECTION_STRING);
const close = async () => await db$1.close();

var database = {
    init: init$1,
    close
};

path.resolve(__dirname$1, '../../');

let bree = null;
let db = null;
let jobsRoot = null;

// 让使用者通过环境变量或配置指定 jobs 目录
const getJobsRoot = () => {
    if (jobsRoot) return jobsRoot

    // 多种方式获取 jobs 目录
    // 1. 环境变量
    if (process.env.BREE_JOBS_PATH) {
        jobsRoot = path.resolve(process.env.BREE_JOBS_PATH);
        return jobsRoot
    }

    // 2. 使用当前工作目录（项目根目录）
    const cwd = process.cwd();
    const possiblePaths = [
        path.join(cwd, 'src/jobs'),
        path.join(cwd, 'jobs'),
        path.join(cwd, 'dist/jobs'),
    ];

    for (const p of possiblePaths) {
        if (fs$1.existsSync(p)) {
            jobsRoot = p;
            return jobsRoot
        }
    }

    // 3. 默认使用当前工作目录下的 src/jobs
    jobsRoot = path.join(cwd, 'src/jobs');
    console.warn(`Jobs directory not found, using default: ${jobsRoot}`);
    return jobsRoot
};

const createBree = () => {
    const jobsPath = getJobsRoot();
    // 确保 jobs 目录存在（创建警告但不自动创建，因为这是使用者的责任）
    if (!fs$1.existsSync(jobsPath)) {
        console.warn(`⚠️  Jobs directory not found: ${jobsPath}`);
        console.warn(`   Please create it or set BREE_JOBS_PATH environment variable`);
    }
    const instance = new Bree({
        hasSeconds: true,
        root: jobsPath,
        errorHandler: async (error, workerMetadata) => {
            if (workerMetadata?.threadId) {
                blogger.worker(workerMetadata.name,
                    `There was an error while running a worker ${workerMetadata.name} with thread ID: ${workerMetadata.threadId}`);
            } else {
                blogger.worker(workerMetadata.name,
                    `There was an error while running a worker ${workerMetadata.name}`);
            }

            blogger.error(workerMetadata?.name, error);
            if (error?.message?.indexOf('exited with code') > -1) return
            const job = instance.config.jobs.find(x => x.name === workerMetadata?.name);
            const workerData = job?.worker?.workerData;
            if (workerData) {
                await db('Sys_BreeJobs')
                    .where('ID', workerData.id)
                    .update({
                        'ResultStatus': 1,
                        'ErrorMessage': error?.stack
                    });
            }
        }
    });

    instance.on('worker created', (name) => {
        console.log('worker created', name);
        blogger.worker(name, 'worker created');
    });

    instance.on('worker deleted', (name) => {
        console.log('worker deleted', name);
        blogger.worker(name, 'worker deleted');
    });

    return instance
};

const getBree = () => {
    return bree
};

const reset = async (job, startStatus) => {
    await bree.stop(job.name);
    const index = bree.config.jobs.findIndex(x => x.name === job.name);
    if (index !== -1) bree.config.jobs.splice(index, 1);
    await bree.add(job);
    if (startStatus) await bree.start(job.name);
};

const remove = async (name) => {
    await bree.stop(name);

    // 删除运行中的 worker 貌似不需要
    // delete bree.workers.get(name)

    const index = bree.config.jobs.findIndex(x => x.name === name);
    if (index !== -1) bree.config.jobs.splice(index, 1);
};

const create = async (job) => {
    if (bree.config.jobs.some(x => x.name === job.name))
        return

    await bree.add(job);
};

// 启动任务
const start = async (name) => {
    await bree.start(name);
};
// 停止任务
const stop = async (name) => {
    await bree.stop(name);
};
// 执行一次任务
const run = async (name) => {
    await bree.run(name);
};

// 任务初始化
const init = async () => {
    // 1. 从数据库读取任务列表
    db = await database.init();
    // 2. 创建 Bree 实例（在数据库初始化之后）
    bree = createBree();
    // 3. 从数据库读取任务列表
    const jobs = await db('Sys_BreeJobs'); //.where('Status', 1)
    // 4. 批量注册到调度器
    for (const job of jobs) {
        const id = job['ID'];
        const name = job['Name'];
        const cron = job['Cron'];
        const path = job['Path'];
        const status = job['Status']; // status 状态为0：已停止 1：执行中 2：
        const createStatus = job['CreateStatus'];

        try {
            await create({
                name,
                cron,
                path: path || undefined,
                worker: { workerData: { id } }
            });

            if (status === 1) await bree.start(name);
            if (createStatus === 0) {
                await db('Sys_BreeJobs')
                    .where('ID', id)
                    .update({
                        'CreateStatus': 1
                    });
            }
        }
        catch (error) {
            blogger.error(name, error);
            await db('Sys_BreeJobs')
                .where('ID', id)
                .update({
                    'ResultStatus': 1,
                    'ErrorMessage': error?.stack
                });
        }
    }
};

var scheduler = {
    init,
    create,
    reset,
    start,
    stop,
    run,
    getBree,
    remove
};

const { combine: combine$1, timestamp: timestamp$1, printf: printf$1 } = winston.format;
const logFormat$1 = printf$1(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
});

/**
 * 日志级别过滤器
 */
const levelFilter = (level) => {
    return winston.format((info) => {
        return info.level === level ? info : false
    })()
};

const logger = winston.createLogger({
    level: 'info',
    format: combine$1(
        timestamp$1({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat$1
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'info-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            format: combine$1(
                levelFilter('info'),
                timestamp$1({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat$1
            )
        }),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'error-%DATE%.log',
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            format: combine$1(
                levelFilter('error'),
                timestamp$1({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat$1
            )
        })
    ]
});

function useHandler() {
    let isCancelled = false;
    let db = null;

    const getIsCancelled = () => isCancelled;
    const updateTask = async (obj) => {
        await db('Sys_BreeJobs')
            .where('ID', workerData.id)
            .update(obj);
    };
    const run = async (worker) => {
        if (parentPort)
            parentPort.once('message', (message) => {
                console.log(message);
                if (message === 'cancel') isCancelled = true;
            });

        db = await database.init();

        try {
            const result = await worker({ logger, redis, db });
            await updateTask({ 'ResultStatus': 0, 'ExecuteResult': result });
        } catch (err) {
            await updateTask({ 'ResultStatus': 1, 'ErrorMessage': err.message });
            logger.error(`${err?.stack || err?.message || err}`);
        } finally {
            await redis.close();
            await database.close(); // 关闭连接池
            if (parentPort) {
                parentPort.postMessage("done");
            } else {
                process.exit(0);
            }
        }
    };

    return { run, getIsCancelled }
}

const ALGORITHM_MAP = {
    16: 'aes-128-ecb',
    24: 'aes-192-ecb',
    32: 'aes-256-ecb'
};

const encrypt = (data, key) => {
    // key 必须 16 / 24 / 32 字节
    const keyBuf = Buffer.from(key, 'utf8');
    const cipher = crypto.createCipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null);
    cipher.setAutoPadding(true); // PKCS7
    const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final()
    ]);
    return encrypted
};

const decrypt = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8');
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final()
    ]);
    return decrypted
};

/**
 * AES解密
 * 对应 Java:
 * AesUtil.decrypt(String data, String key)
 *
 * @param {string} data Base64密文
 * @param {string} key AES密钥(16/24/32字节)
 * @returns {string} 明文
 */
const decryptString = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8');
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final()
    ]);
    return decrypted.toString('utf8')
};

var aes = { encrypt, decrypt, decryptString };

function auth(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(200).json({
            code: -1,
            message: 'Missing API Key'
        })
    }

    const decryptedApiKey = aes.decryptString(apiKey, process.env.API_SECRET_KEY);
    if (!decryptedApiKey || decryptedApiKey !== process.env.API_TOKEN) {
        return res.status(200).json({
            code: -1,
            message: 'Unauthorized'
        })
    }

    let ip = req.ip;
    console.log('Request IP:', ip);
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    const allowIps = process.env.ALLOW_IPS?.split(',') || [];
    if (!allowIps.includes(ip)) {
        return res.status(200)
            .json({
                code: -1,
                message: 'IP forbidden'
            })
    }

    next();
}

const { combine, timestamp, printf } = winston.format;
const logFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
});

const weixinLogger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'weixinapi-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
});

/**
 * worker日志
 */
const info = (apiName, message) => {
    weixinLogger.info(`[${apiName}] ${message}`);
};

/**
 * error日志
 */
const error = (apiName, err) => {
    weixinLogger.error(`[${apiName}] ${err?.stack || err?.message || err}`);
};
var weixinLogger_default = { info, error };

export { aes$1 as aes, auth, database, excelUtil as excel, mailUtil as mail, redis, scheduler, useDatabase, useHandler, weixinLogger_default as weixinLogger };
//# sourceMappingURL=index.js.map
