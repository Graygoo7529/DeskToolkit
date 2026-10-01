import { useRef, useState } from 'react'
import { inspectProvider } from './api'
import type { ProbeResult, ProbeTask, ProviderResults, Scene } from './types'

export function useInspections(scene: Scene) {
  const [results, setResults] = useState<Record<string, ProviderResults>>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ total: 0, done: 0, ok: 0, partial: 0, error: 0, skipped: 0, cancelled: 0 })
  const active = useRef(false)
  const stopped = useRef(false)

  const invalidate = (name: string) => setResults((old) => {
    const next = { ...old }
    delete next[name]
    return next
  })

  const run = async (names: string[], tasks: ProbeTask[]) => {
    if (active.current || !names.length || !tasks.length) return
    active.current = true
    stopped.current = false
    setBusy(true)
    const jobs = names.flatMap((name) => tasks.map((task) => ({ name, task })))
    setProgress({ total: jobs.length, done: 0, ok: 0, partial: 0, error: 0, skipped: 0, cancelled: 0 })
    setResults((old) => {
      const next = { ...old }
      for (const { name, task } of jobs) next[name] = { ...next[name], [task]: { ...next[name]?.[task], pending: 'queued' } }
      return next
    })
    let cursor = 0
    const worker = async () => {
      while (!stopped.current && cursor < jobs.length) {
        const { name, task } = jobs[cursor++]
        setResults((old) => ({ ...old, [name]: { ...old[name], [task]: { ...old[name]?.[task], pending: 'running' } } }))
        let result: ProbeResult
        try {
          result = await inspectProvider(scene, name, task)
        } catch (error) {
          result = { status: 'error', message: String(error), checked_at: Date.now(), latency_ms: 0, http_status: null, models: [], quota: null }
        }
        setResults((old) => ({ ...old, [name]: { ...old[name], [task]: {
          result,
          lastGood: result.status === 'ok' || result.status === 'partial' ? result : old[name]?.[task]?.lastGood,
        } } }))
        setProgress((old) => ({ ...old, done: old.done + 1, [result.status]: old[result.status] + 1 }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker))
    setResults((old) => {
      const next = { ...old }
      for (const { name, task } of jobs.slice(cursor)) next[name] = { ...next[name], [task]: { ...next[name]?.[task], pending: undefined } }
      return next
    })
    setProgress((old) => ({ ...old, cancelled: jobs.length - cursor }))
    active.current = false
    setBusy(false)
  }

  return { results, busy, progress, run, invalidate, stop: () => { stopped.current = true } }
}
