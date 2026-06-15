/**
 * §10 单一真相源：oauth token 一律实时读自 sub2api postgres，工具侧不存第二份。
 * sub2api 自身持续刷新 token（5min 查 / 过期前 30min 刷），故库里 access_token 即"当前真相"。
 * 本机站点(kind=local)走 pg 只读连接；远程站点走 ssh + docker exec psql。token 只进内存供探针，绝不落库/打印。
 */
import { getSite, localPool, sshPsql } from './sites.js'

export interface TokenRow {
  sub2_account_id: number
  access_token: string | null
  id_token: string | null
  chatgpt_account_id: string | null
  ua: string | null
  cpa_email: string | null
}

const COLS = `id,
  credentials->>'access_token' AS access_token,
  credentials->>'id_token' AS id_token,
  credentials->>'chatgpt_account_id' AS chatgpt_account_id,
  credentials->>'email' AS email`
const WHERE = `deleted_at IS NULL AND type='oauth' AND (credentials->>'access_token') IS NOT NULL`

function toRow(r: any): TokenRow {
  return {
    sub2_account_id: Number(r.id),
    access_token: r.access_token ?? null,
    id_token: r.id_token ?? null,
    chatgpt_account_id: r.chatgpt_account_id ?? null,
    ua: null,
    cpa_email: r.email ?? null,
  }
}

/** 返回 {account_id: TokenRow}。无提权通道或读失败 → {}（该站本次跳过深度盘点）。 */
export async function fetchTokens(siteId: number): Promise<Record<number, TokenRow>> {
  const site = getSite(siteId)
  if (!site) return {}
  const res: Record<number, TokenRow> = {}
  try {
    if (site.kind === 'local') {
      const r = await localPool(false).query(`SELECT ${COLS} FROM accounts WHERE ${WHERE}`)
      for (const row of r.rows) { const tr = toRow(row); if (tr.access_token) res[tr.sub2_account_id] = tr }
      return res
    }
    const ssh = (site.ssh_host || '').trim()
    const pgc = (site.pg_container || '').trim()
    if (!ssh || !pgc) return {}
    const sql = `select coalesce(json_agg(json_build_object('id',id,'access_token',credentials->>'access_token','id_token',credentials->>'id_token','chatgpt_account_id',credentials->>'chatgpt_account_id','email',credentials->>'email')),'[]') from accounts where ${WHERE};`
    const out = await sshPsql(ssh, pgc, sql)
    if (!out) return {}
    for (const row of JSON.parse(out) as any[]) { const tr = toRow(row); if (tr.access_token) res[tr.sub2_account_id] = tr }
    return res
  } catch (e) {
    console.error(`[token回源] 站点${siteId} 读 sub2api postgres 失败，跳过深度盘点: ${e instanceof Error ? e.message : e}`)
    return {}
  }
}
