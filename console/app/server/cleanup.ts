/**
 * 失效号清理：异步并发删 + 进度 + 急停 + 回收站快照。移植自 web_server._run_cleanup。
 * §10：回收快照的 token 删除前实时取自 sub2api postgres(source_tokens)，不读本地副本。
 */
import { db, nowCst } from './db.js'
import { getClient } from './sites.js'
import { fetchTokens } from './sourceTokens.js'

export interface CleanupState {
  running: boolean; done: number; total: number; deleted: number; failed: number
  current: number | null; abort: boolean; errors: string[]
}
const _bySite = new Map<number, CleanupState>()
export function getCleanup(siteId: number): CleanupState {
  if (!_bySite.has(siteId)) _bySite.set(siteId, { running: false, done: 0, total: 0, deleted: 0, failed: 0, current: null, abort: false, errors: [] })
  return _bySite.get(siteId)!
}

async function pool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.max(1, workers) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]) }
  }))
}

async function runCleanup(siteId: number, ids: number[], workers: number): Promise<void> {
  const st = getCleanup(siteId)
  const c = getClient(siteId)
  const tokens = await fetchTokens(siteId)
  const vmap = new Map<number, string>()
  for (const r of db().prepare('SELECT sub2_account_id,verdict FROM probe_results WHERE site_id=? ORDER BY id DESC').all(siteId) as any[]) {
    if (!vmap.has(r.sub2_account_id)) vmap.set(r.sub2_account_id, r.verdict)
  }
  const insRecycle = db().prepare(`INSERT INTO recycle(site_id,sub2_account_id,cpa_email,name,access_token,refresh_token,id_token,verdict,deleted_at,reason)
                                   VALUES(?,?,?,?,?,?,?,?,?,?)`)
  const delProbe = db().prepare('DELETE FROM probe_results WHERE sub2_account_id=? AND site_id=?')
  try {
    await pool(ids, workers, async (aid) => {
      if (st.abort) return
      st.current = aid
      try { await c.deleteAccount(aid) } catch (e) {
        st.failed++; st.done++
        if (st.errors.length < 30) st.errors.push(`#${aid}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`)
        return
      }
      const t = tokens[aid]
      insRecycle.run(siteId, aid, t?.cpa_email || null, null, t?.access_token || null, null, t?.id_token || null, vmap.get(aid) || null, nowCst(), 'cleanup')
      delProbe.run(aid, siteId)
      st.deleted++; st.done++
    })
  } finally {
    st.running = false; st.current = null
  }
}

export function startCleanup(body: any): { started: boolean; msg?: string; total?: number } {
  const siteId = Number(body.site_id || 1)
  const ids: number[] = (body.account_ids || []).map(Number).filter(Boolean)
  if (!ids.length) return { started: false, msg: '无待清理账号' }
  const workers = Math.min(32, Math.max(1, Number(body.workers || 16)))
  const st = getCleanup(siteId)
  if (st.running) return { started: false, msg: '已有清理在进行中' }
  st.running = true; st.done = 0; st.total = ids.length; st.deleted = 0; st.failed = 0; st.current = null; st.abort = false; st.errors = []
  runCleanup(siteId, ids, workers).catch((e) => { st.errors.push(String(e instanceof Error ? e.message : e).slice(0, 80)); st.running = false })
  return { started: true, total: ids.length }
}
