/**
 * 配置 + 凭据加解密 + 管理员密码门。
 * 凭据加密方案与 pool-manager config.py 一致（PBKDF2-SHA256 派生 + HMAC keystream + tag），
 * 便于必要时互通；主密钥 CONSOLE_MASTER_KEY 缺失则生成并落 settings(不入仓库/不打印明文)。
 */
import crypto from 'node:crypto'
import { getSetting, setSetting } from './db.js'

export const PROBE_MODEL = process.env.CONSOLE_PROBE_MODEL || 'gpt-5.5'

// 本机站点的 sub2api postgres 连接（观测 + 本机 token 回源用只读；改 role 用可写）
export const DATABASE_URL = process.env.DATABASE_URL || ''
export const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL || DATABASE_URL

// 中转接入「使用用」API Key 的默认 sub2api 管理员登录（建 key 需用户态 JWT，admin-api-key 不行）。
// 表单留空时回退用它登录 /auth/login 建 key。email 缺省 admin@sub2api.local；
// 密码填 sub2api 管理员登录密码（非本 console 密码），不入仓库、不打印明文。
export const SUB2_ADMIN_EMAIL = process.env.CONSOLE_SUB2_ADMIN_EMAIL || 'admin@sub2api.local'
export const SUB2_ADMIN_PASSWORD = process.env.CONSOLE_SUB2_ADMIN_PASSWORD || ''

function masterKey(): string {
  const env = process.env.CONSOLE_MASTER_KEY
  if (env) return env
  let k = getSetting('master_key')
  if (!k) {
    k = crypto.randomBytes(32).toString('hex')
    setSetting('master_key', k)
    console.log('[config] 已生成 master_key 并存入 settings（随 SQLite 卷备份）')
  }
  return k
}

function keystream(key: Buffer, salt: Buffer, n: number): Buffer {
  const out: Buffer[] = []
  let ctr = 0
  let len = 0
  while (len < n) {
    const blk = crypto.createHmac('sha256', key)
      .update(Buffer.concat([salt, Buffer.from([(ctr >>> 24) & 0xff, (ctr >>> 16) & 0xff, (ctr >>> 8) & 0xff, ctr & 0xff])]))
      .digest()
    out.push(blk)
    len += blk.length
    ctr++
  }
  return Buffer.concat(out).subarray(0, n)
}

export function encryptCredential(text: string): string {
  if (!text) return ''
  const mk = Buffer.from(masterKey(), 'utf8')
  const salt = crypto.randomBytes(16)
  const dk = crypto.pbkdf2Sync(mk, salt, 100_000, 32, 'sha256')
  const pt = Buffer.from(text, 'utf8')
  const ks = keystream(dk, salt, pt.length)
  const ct = Buffer.alloc(pt.length)
  for (let i = 0; i < pt.length; i++) ct[i] = pt[i] ^ ks[i]
  const tag = crypto.createHmac('sha256', dk).update(Buffer.concat([salt, ct])).digest().subarray(0, 16)
  return Buffer.concat([salt, tag, ct]).toString('base64')
}

export function decryptCredential(blob: string): string {
  if (!blob) return ''
  const mk = Buffer.from(masterKey(), 'utf8')
  const raw = Buffer.from(blob, 'base64')
  const salt = raw.subarray(0, 16)
  const tag = raw.subarray(16, 32)
  const ct = raw.subarray(32)
  const dk = crypto.pbkdf2Sync(mk, salt, 100_000, 32, 'sha256')
  const expect = crypto.createHmac('sha256', dk).update(Buffer.concat([salt, ct])).digest().subarray(0, 16)
  if (!crypto.timingSafeEqual(tag, expect)) throw new Error('凭据被篡改或 master_key 不匹配')
  const ks = keystream(dk, salt, ct.length)
  const pt = Buffer.alloc(ct.length)
  for (let i = 0; i < ct.length; i++) pt[i] = ct[i] ^ ks[i]
  return pt.toString('utf8')
}

// ---- 管理员密码门 ----
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

/** 首启从 env CONSOLE_ADMIN_PASSWORD 播种密码哈希(只存哈希)；返回是否已设密码。 */
export function ensureAdminPassword(): boolean {
  let h = getSetting('admin_pass_hash')
  const envPw = process.env.CONSOLE_ADMIN_PASSWORD
  if (envPw) {
    const envHash = sha256(envPw)
    if (h !== envHash) { setSetting('admin_pass_hash', envHash); h = envHash }
  }
  return !!h
}

export function verifyAdminPassword(pw: string): boolean {
  const h = getSetting('admin_pass_hash')
  if (!h) return false
  const a = Buffer.from(sha256(pw))
  const b = Buffer.from(h)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function hasAdminPassword(): boolean { return !!getSetting('admin_pass_hash') }
export function setAdminPassword(pw: string): void { setSetting('admin_pass_hash', sha256(pw)) }

/** 会话签名密钥（持久化于 settings，重启后会话不失效）。 */
export function sessionSecret(): string {
  let s = getSetting('session_secret')
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('session_secret', s) }
  return s
}
