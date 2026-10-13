import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren } from 'claude-code'

import type { CleanViewChecklist, CleanViewTask } from '../types'

type $ = EngineInterface
type Checklist = CleanViewChecklist
type Task = CleanViewTask

export const PLAN_TOOL = 'mcp__clean-view__plan_steps'
export const PROGRESS_TOOL = 'mcp__clean-view__report_progress'

const enabled = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklist = atom({ plugin: 'clean-view', key: 'checklist' } as const, null)
const tickAtom = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)

const ALWAYS_ALLOWED = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'AskUserQuestion'])
const STORE_KEY = 'cleanViewEnabled'
const MAX_NAME = 40
const METER = 10

const GUIDE = `# Clean View is on

The person sees a simple checklist of your plan instead of tool calls, so keep it accurate and friendly.

- For every request, even a quick question, call \`plan_steps\` first (load it with ToolSearch if it is deferred): 2 to 8 short steps, in order.
- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- Call \`report_progress\` as real progress happens, and with percent 100 the moment a step finishes.
- If this session has TodoWrite or TaskCreate, you may use your to-do list as the plan instead.`

const CODE_FILE = /\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|mts|cts|json|php|py|rb|cs|go|rs|java|kt|swift|c|cc|cpp|h|hpp|css|scss|less|html?|vue|svelte|md|ya?ml|toml|ini|sh|zsh|bash|sql|lock|env|xml|csproj|sln)\b/gi

/** The one cleaner every step and job name passes through. */
export function cleanName(raw: string): string {
  let s = String(raw ?? '')
    .replace(/`[^`]*`?/g, ' ')
    .split(/\s+/)
    .filter(word => !word.includes('/') && !word.includes('\\'))
    .join(' ')
    .replace(CODE_FILE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > MAX_NAME) {
    const cut = s.slice(0, MAX_NAME - 1)
    const space = cut.lastIndexOf(' ')
    s = (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '') + '…'
  }
  if (s === '' || s === '…') return 'Working on it'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function apiErrorSentence(kind: string | undefined, details = ''): string {
  if (/too long|context|too many tokens/i.test(details)) return 'type /compact and try again'
  if (/network|ECONN|ENOTFOUND|socket|fetch failed|offline|connection/i.test(details)) return 'the internet connection dropped'
  if (kind === 'rate_limit' || kind === 'billing_error') return 'you hit your usage limit, try again a little later'
  if (kind === 'overloaded' || kind === 'server_error') return "Claude's servers are busy, try again in a minute"
  if (kind === 'authentication_failed' || kind === 'oauth_org_not_allowed' || kind === 'cloud_credential_error') return 'type /login'
  return 'something went wrong, try again'
}

const USER_SAID_NO = /user (?:doesn't|does not) want to proceed|user rejected|rejected by the user|denied by the user|user declined/i

// --- state edits ------------------------------------------------------------

// Module timers die with a reload; session.start resyncs them.
let timer: { cancel: () => void } | undefined
let failures = 0
let lastApiError: { kind?: string; details?: string } | null = null

function syncTimer($: $, list: Checklist | null) {
  const isLive = list !== null && (list.phase === 'working' || list.phase === 'needs-you')
  if (isLive && timer === undefined) timer = $.clock.every(250, () => void update($, tickAtom, n => (n ?? 0) + 1))
  if (!isLive && timer !== undefined) {
    timer.cancel()
    timer = undefined
  }
}

async function edit($: $, fn: (list: Checklist | null) => Checklist | null) {
  let out = null as Checklist | null
  await update($, checklist, list => (out = fn(list ?? null)))
  syncTimer($, out)
  return out
}

function newList(now: number, title: string): Checklist {
  return {
    title,
    phase: 'working',
    tasks: [
      { id: 'placeholder-1', name: 'Understand your request', status: 'active', percent: 0, hasReported: false },
      { id: 'placeholder-2', name: 'Plan the steps', status: 'upcoming', percent: 0, hasReported: false },
    ],
    needsYouReason: null,
    stuckReason: null,
    startedAt: now,
    finishedAt: null,
    isCollapsed: false,
    isPlanned: false,
  }
}

function working(list: Checklist): Checklist {
  return { ...list, phase: 'working', needsYouReason: null, stuckReason: null, finishedAt: null, isCollapsed: false }
}

/** Makes the first unfinished step active when none is. */
function ensureActive(tasks: Task[]): Task[] {
  if (tasks.some(t => t.status === 'active')) return tasks
  const i = tasks.findIndex(t => t.status !== 'done')
  return i < 0 ? tasks : tasks.map((t, j) => (j === i ? { ...t, status: 'active' } : t))
}

export function applyPlan(list: Checklist, steps: string[]): Checklist {
  const tasks: Task[] = steps.map((step, i) => ({
    id: `step-${i + 1}`,
    name: cleanName(step),
    status: i === 0 ? 'active' : 'upcoming',
    percent: 0,
    hasReported: false,
  }))
  return { ...working(list), tasks, isPlanned: true }
}

export function applyProgress(list: Checklist, rawName: string, rawPercent: number): Checklist {
  const name = cleanName(rawName)
  const percent = Math.min(100, Math.max(0, Math.round(Number.isFinite(rawPercent) ? rawPercent : 0)))
  let tasks = list.isPlanned ? [...list.tasks] : []
  let at = tasks.findIndex(t => t.name.toLowerCase() === name.toLowerCase())
  if (at < 0) {
    tasks.push({ id: `step-${tasks.length + 1}-${name}`, name, status: 'upcoming', percent: 0, hasReported: false })
    at = tasks.length - 1
  }
  tasks = tasks.map((t, i): Task => {
    if (i < at) return { ...t, status: 'done', percent: 100 }
    if (i === at) return { ...t, status: percent >= 100 ? 'done' : 'active', percent, hasReported: true }
    return t.status === 'active' ? { ...t, status: 'upcoming' } : t
  })
  if (percent >= 100) {
    const nextAt = tasks.findIndex((t, i) => i > at && t.status !== 'done')
    const following = tasks[nextAt]
    if (following) tasks[nextAt] = { ...following, status: 'active', percent: 0, hasReported: false }
  }
  return { ...list, tasks }
}

type Todo = { content?: unknown; status?: unknown }

function fromTodos(list: Checklist, todos: Todo[]): Checklist {
  const old = new Map(list.tasks.map(t => [t.name, t]))
  const tasks = todos.map((todo, i): Task => {
    const name = cleanName(String(todo.content ?? ''))
    const prior = old.get(name)
    if (todo.status === 'completed') return { id: `todo-${i + 1}`, name, status: 'done', percent: 100, hasReported: true }
    const status = todo.status === 'in_progress' ? 'active' : 'upcoming'
    return { id: `todo-${i + 1}`, name, status, percent: prior?.percent ?? 0, hasReported: prior?.hasReported ?? false }
  })
  return { ...list, tasks: ensureActive(tasks), isPlanned: true }
}

// --- the job's life -----------------------------------------------------------

async function nameJob($: $, text: string, startedAt: number) {
  const prompt = `Name this job in 2 to 6 plain words a non-technical person understands, starting with a verb. No file names, code or punctuation. Reply with the name only.\n\nRequest: ${text.slice(0, 2000)}`
  try {
    let answer = await $.model.complete({ model: 'haiku', effort: 'low', maxTokens: 24, timeoutMs: 15000, prompt })
    if (!answer.isAnswered && answer.reason === 'api-error') answer = await $.model.complete({ model: 'haiku', maxTokens: 24, timeoutMs: 15000, prompt })
    if (!answer.isAnswered) return
    const words = (answer.text.split('\n')[0] ?? '').replace(/["'*.]/g, '').trim().split(/\s+/).slice(0, 6).join(' ')
    if (words === '') return
    await edit($, list => (list !== null && list.startedAt === startedAt ? { ...list, title: cleanName(words) } : list))
  } catch {
    // The placeholder title stays.
  }
}

async function onPrompt($: $, text: string) {
  const now = await $.clock.now()
  failures = 0
  lastApiError = null
  let startedAt: number | null = null
  await edit($, list => {
    // A reply to "Needs you" or "Stuck" carries the same job on.
    if (list !== null && (list.phase === 'needs-you' || list.phase === 'stuck' || list.phase === 'working')) return working(list)
    startedAt = now
    return newList(now, cleanName(text.split(/\s+/).slice(0, 6).join(' ')))
  })
  if (startedAt !== null) void nameJob($, text, startedAt)
}

async function setNeedsYou($: $, reason: string) {
  await edit($, list => (list === null || list.phase === 'done' || list.phase === 'stopped' ? list : { ...list, phase: 'needs-you', needsYouReason: reason }))
}

async function clearNeedsYou($: $) {
  await edit($, list => (list?.phase === 'needs-you' ? { ...list, phase: 'working', needsYouReason: null } : list))
}

async function setStuck($: $, reason: string) {
  await edit($, list => (list === null ? list : { ...list, phase: 'stuck', stuckReason: reason, needsYouReason: null }))
}

async function noteOutcome($: $, ran: { deny?: string; isError?: true; text?: string; result?: unknown }) {
  if (ran.deny !== undefined) return
  if (ran.isError) {
    const said = `${ran.text ?? ''} ${typeof ran.result === 'string' ? ran.result : ''}`
    if (USER_SAID_NO.test(said)) return setStuck($, 'you said no to a step, so Claude paused')
    failures += 1
    if (failures >= 3) await setStuck($, 'a step keeps failing, Claude is trying another way')
    return
  }
  failures = 0
  await edit($, list => (list?.phase === 'stuck' ? { ...list, phase: 'working', stuckReason: null } : list))
}

async function onTurnComplete($: $, reason: string) {
  const now = await $.clock.now()
  const error = lastApiError
  lastApiError = null
  let doneJob: number | null = null
  await edit($, list => {
    if (list === null) return list
    if (reason === 'error') return { ...list, phase: 'stuck', stuckReason: apiErrorSentence(error?.kind, error?.details), needsYouReason: null }
    if (reason === 'refusal') return { ...list, phase: 'stuck', stuckReason: "Claude couldn't help with that request", needsYouReason: null }
    if (reason === 'aborted') return { ...list, phase: 'stopped', finishedAt: now, needsYouReason: null }
    const isUnfinished = list.isPlanned && list.tasks.some(t => t.status !== 'done')
    if (isUnfinished && list.phase === 'stuck') return list
    if (isUnfinished) return { ...list, phase: 'needs-you', needsYouReason: 'Claude is waiting for your reply' }
    doneJob = list.startedAt
    const tasks = list.tasks.map((t): Task => ({ ...t, status: 'done', percent: 100 }))
    return { ...list, tasks, phase: 'done', finishedAt: now, needsYouReason: null, stuckReason: null, isCollapsed: false }
  })
  if (doneJob !== null) {
    const startedOf = doneJob
    $.clock.after(5000, () => {
      void edit($, list => (list !== null && list.phase === 'done' && list.startedAt === startedOf ? { ...list, isCollapsed: true } : list))
    })
  }
}

async function toggle($: $, to?: boolean) {
  let now = true
  await update($, enabled, was => (now = to ?? !(was ?? true)))
  await $.store.set(STORE_KEY, now)
  $.ui.toast(now ? 'Clean View is on: tool details are hidden' : 'Clean View is off: showing everything')
  return now
}

// --- drawing ------------------------------------------------------------------

function fit(text: string, width: number): string {
  if (text.length > width) return text.slice(0, Math.max(0, width - 1)) + '…'
  return text.padEnd(width)
}

// A soft pastel palette that reads well on dark terminals.
const PALETTE = {
  peach: '#FAB387',
  pink: '#F38BA8',
  mauve: '#CBA6F7',
  blue: '#89B4FA',
  green: '#A6E3A1',
  yellow: '#F9E2AF',
  red: '#EBA0AC',
  text: '#CDD6F4',
  subtle: '#7F849C',
  track: '#45475A',
}
const TITLE_RAMP = [PALETTE.peach, PALETTE.pink, PALETTE.mauve, PALETTE.blue]
const SWEEP_FADE = ['#3B3052', '#5B4A7A', '#8C7BD0', '#B4BEFE']
const SPARKLE = ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷']

function hex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The colour at `t` (0..1) along a ramp of hex stops. */
function rampAt(stops: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = hex(stops[i] ?? '#000000')
  const b = hex(stops[i + 1] ?? '#000000')
  const f = x - i
  return '#' + a.map((v, k) => Math.round(v + ((b[k] ?? 0) - v) * f).toString(16).padStart(2, '0')).join('')
}

type Cell = { char: string; color: string }

function meter(task: Task, tick: number, isAnimated: boolean): Cell[] {
  const ramp = (i: number) => rampAt([PALETTE.pink, PALETTE.mauve, PALETTE.blue], i / (METER - 1))
  const track = (): Cell => ({ char: '░', color: PALETTE.track })
  if (task.status === 'done') return Array.from({ length: METER }, () => ({ char: '█', color: PALETTE.green }))
  if (task.status === 'upcoming') return Array.from({ length: METER }, track)
  if (task.hasReported) {
    const filled = Math.round(task.percent / 10)
    return Array.from({ length: METER }, (_, i) => (i < filled ? { char: '█', color: ramp(i) } : track()))
  }
  // No percent yet: a fading four-cell comet bouncing across the meter.
  const step = isAnimated ? tick % 12 : 0
  const head = step < 7 ? step + 3 : 15 - step
  const dir = step < 7 ? 1 : -1
  return Array.from({ length: METER }, (_, i) => {
    const behind = (head - i) * dir
    const shade = SWEEP_FADE[SWEEP_FADE.length - 1 - behind]
    return behind >= 0 && shade !== undefined ? { char: '█', color: shade } : track()
  })
}

function label(task: Task, firstUpcoming: boolean): string {
  if (task.status === 'done') return 'Done'
  if (task.status === 'upcoming') return firstUpcoming ? 'Next' : 'Up next'
  return task.hasReported ? `${task.percent}%` : 'Working'
}

// --- hooks ----------------------------------------------------------------------

export function registerCleanView(on: On) {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved === 'boolean') await update($, enabled, () => saved)
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, before any other tool: 2 to 8 short plain-English step names, in order, each under 40 characters and starting with a verb. No file names, paths, commands or code. The first step starts right away.',
      inputSchema: {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 } },
        required: ['steps'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step, by its name from plan_steps, as real progress happens. Send percent 100 the moment a step finishes; the next step then starts. A name not in the plan becomes a new step.',
      inputSchema: {
        type: 'object',
        properties: { task: { type: 'string' }, percent: { type: 'number', minimum: 0, maximum: 100 } },
        required: ['task', 'percent'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'simple', description: 'Turn Clean View on or off', argumentHint: 'on|off' })
    syncTimer($, await read($, checklist))
    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = await toggle($, arg === 'on' ? true : arg === 'off' ? false : undefined)
    return { text: isOn ? 'Clean View is on.' : 'Clean View is off.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabled))) return composed
    return { ...composed, sections: [...composed.sections, { id: 'clean-view:guide', text: GUIDE, scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    if (text !== '' && !text.startsWith('/')) await onPrompt($, text)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (tool === PLAN_TOOL) {
      const steps = Array.isArray(input.steps) ? input.steps.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []
      if (steps.length === 0) return { deny: 'plan_steps needs 2 to 8 short step names.' }
      const now = await $.clock.now()
      const list = await edit($, l => applyPlan(l ?? newList(now, 'Working on it'), steps.slice(0, 8)))
      return { result: `Planned ${list?.tasks.length ?? 0} steps. The first one has started.` }
    }
    if (tool === PROGRESS_TOOL) {
      const now = await $.clock.now()
      const percent = Math.min(100, Math.max(0, Number(input.percent) || 0))
      await edit($, l => applyProgress(l ?? newList(now, 'Working on it'), String(input.task ?? ''), percent))
      return { result: `Progress noted: ${Math.round(percent)}%.` }
    }
    if (e.agentId !== undefined) return next(e)

    if ((await read($, enabled)) && !ALWAYS_ALLOWED.has(tool) && !(await read($, checklist))?.isPlanned) {
      return { deny: 'Clean View: call plan_steps first to lay out the steps of this job (load it with ToolSearch if it is deferred), then try again.' }
    }

    await clearNeedsYou($)
    if (tool === 'AskUserQuestion') await setNeedsYou($, 'Claude has a question for you')
    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const now = await $.clock.now()
      await edit($, l => fromTodos(l ?? newList(now, 'Working on it'), input.todos as Todo[]))
    }
    if (tool === 'TaskUpdate') {
      await edit($, l => {
        if (l === null) return l
        const id = String(input.taskId)
        if (input.status === 'deleted') return { ...l, tasks: ensureActive(l.tasks.filter(t => t.id !== id)) }
        const tasks = l.tasks.map((t): Task => {
          if (t.id !== id) return t
          const named = typeof input.subject === 'string' ? { ...t, name: cleanName(input.subject) } : t
          if (input.status === 'completed') return { ...named, status: 'done', percent: 100, hasReported: true }
          if (input.status === 'in_progress') return { ...named, status: 'active' }
          if (input.status === 'pending') return { ...named, status: 'upcoming' }
          return named
        })
        return { ...l, tasks: ensureActive(tasks) }
      })
    }

    const ran = await next(e)

    if (tool === 'TaskCreate' && ran.deny === undefined && !ran.isError) {
      const made = (ran.result as { task?: { id?: string } } | undefined)?.task
      const now = await $.clock.now()
      await edit($, l => {
        const base = l ?? newList(now, 'Working on it')
        const tasks = base.isPlanned ? base.tasks : []
        const task: Task = { id: String(made?.id ?? `task-${tasks.length + 1}`), name: cleanName(String(input.subject ?? '')), status: 'upcoming', percent: 0, hasReported: false }
        return { ...base, tasks: ensureActive([...tasks, task]), isPlanned: true }
      })
    }
    await clearNeedsYou($)
    await noteOutcome($, ran)
    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') await setNeedsYou($, 'Claude needs your OK to continue')
    if (e.notification_type === 'elicitation_dialog') await setNeedsYou($, 'Claude has a question for you')
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    lastApiError = { kind: e.error, details: e.error_details }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await onTurnComplete($, e.reason)
    return next(e)
  })

  // --- hide the technical rows ---

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabled)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  // --- the band ---

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const isOn = await read($, enabled)
    const list = await read($, checklist)
    const tick = await read($, tickAtom)

    const button = (
      <Button key="clean-view-toggle" label={isOn ? '● Clean View: ON' : '○ Clean View: OFF'} onPress={() => void toggle($)} />
    )
    const plainRow = (left: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{left}</Box>
        {button}
      </Box>
    )
    if (!isOn || list === null) return plainRow(<Text> </Text>)

    const now = await $.clock.now()
    const took = duration((list.finishedAt ?? now) - list.startedAt)
    const accent = {
      'working': PALETTE.pink,
      'needs-you': PALETTE.yellow,
      'stuck': PALETTE.red,
      'stopped': PALETTE.subtle,
      'done': PALETTE.green,
    }[list.phase]
    const isAnimated = list.phase === 'working' || list.phase === 'needs-you'

    const words = list.title.split(' ')
    const title = words.map((word, i) => (
      <Text bold color={rampAt(TITLE_RAMP, words.length === 1 ? 0 : i / (words.length - 1))}>
        {i === 0 ? word : ` ${word}`}
      </Text>
    ))
    const header = (() => {
      switch (list.phase) {
        case 'needs-you':
          return (
            <Text wrap="truncate-end">
              <Text inverse bold color={PALETTE.yellow}> Needs you </Text>
              <Text color={PALETTE.text}> {list.needsYouReason ?? ''}</Text>
            </Text>
          )
        case 'stuck':
          return <Text wrap="truncate-end" bold color={PALETTE.red}>⚠ Stuck: {list.stuckReason ?? ''}</Text>
        case 'stopped':
          return (
            <Text wrap="truncate-end" color={PALETTE.subtle}>
              ■ Stopped · {title} · you pressed Esc
            </Text>
          )
        case 'done':
          return (
            <Text wrap="truncate-end">
              <Text bold color={PALETTE.green}>✓ All done · </Text>
              {title}
              <Text color={PALETTE.subtle}> · took {took}</Text>
            </Text>
          )
        default:
          return (
            <Text wrap="truncate-end">
              <Text color={accent}>{SPARKLE[tick % SPARKLE.length]} </Text>
              {title}
            </Text>
          )
      }
    })()
    const headerRow = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{header}</Box>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {list.phase === 'working' && <Text color={PALETTE.subtle}>{took}</Text>}
          {button}
        </Box>
      </Box>
    )
    if (list.phase === 'done' && list.isCollapsed) return headerRow

    const total = list.tasks.length
    const doneCount = list.tasks.filter(t => t.status === 'done').length
    const active = list.tasks.find(t => t.status === 'active')
    const overall = total === 0 ? 0 : Math.round((doneCount * 100 + (active?.percent ?? 0)) / total)
    const stepOf = Math.min(total, doneCount + (active ? 1 : 0))

    // border 2 + padding 2, then glyph 2 + name + space + meter 10 + two spaces + label 7
    const nameWidth = Math.max(6, e.props.bodyColumns - 4 - 2 - 1 - METER - 2 - 7)
    const firstUpcoming = list.tasks.findIndex(t => t.status === 'upcoming')
    const cells = (task: Task) => meter(task, tick, isAnimated).map(cell => <Text color={cell.color}>{cell.char}</Text>)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
        {headerRow}
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={PALETTE.subtle}>Step {Math.max(1, stepOf)} of {total}</Text>
          <Text bold color={accent}>{overall}%</Text>
        </Box>
        {list.tasks.map((task, i) => {
          const name = fit(task.name, nameWidth)
          if (task.status === 'done') {
            return (
              <Text wrap="truncate-end">
                <Text color={PALETTE.green}>✓ </Text>
                <Text color={PALETTE.subtle}>{name} </Text>
                {cells(task)}
                <Text color={PALETTE.green}>  {label(task, false)}</Text>
              </Text>
            )
          }
          if (task.status === 'active') {
            const isWaiting = list.phase === 'needs-you'
            return (
              <Text wrap="truncate-end">
                <Text color={isWaiting ? PALETTE.yellow : PALETTE.pink}>{isWaiting ? '‖ ' : '▶ '}</Text>
                <Text bold color={PALETTE.text}>{name} </Text>
                {cells(task)}
                <Text bold color={accent}>  {label(task, false)}</Text>
              </Text>
            )
          }
          return (
            <Text wrap="truncate-end" color={PALETTE.subtle}>
              ○ {name} {cells(task)}  {label(task, i === firstUpcoming)}
            </Text>
          )
        })}
      </Box>
    )
  })
}
