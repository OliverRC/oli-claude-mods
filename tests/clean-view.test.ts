import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanName, PLAN_TOOL, PROGRESS_TOOL } from '../hooks/clean-view'

const BAND = {
  plugin: 'clean-view',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80 } as never,
} as const

/** What sits beneath the plugin in a session: the tools, the store, the clock, Haiku. */
function world(on: On) {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Build my landing page', usage: {} } }) as never)
  on('classic.Notification', () => ({}) as never)
  on('command.register', () => ({}) as never)
}

test('names come out plain and short', () => {
  expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe('Build the pricing section in')
  expect(cleanName('Update src/app/page.tsx header')).toBe('Update header')
  expect(cleanName('fix Pricing.tsx layout')).toBe('Fix layout')
  const long = cleanName('Rewrite the whole onboarding flow so new customers understand every single option')
  expect(long.length <= 40).toBe(true)
  expect(long.endsWith('…')).toBe(true)
  expect(cleanName('`npm run build`')).toBe('Working on it')
})

test('a to-do list and a 60% report draw done, current, next and up-next rows', async ($, on) => {
  world(on)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing' },
    ],
  } as never)
  await $.tool.call({ tool: PROGRESS_TOOL, task: 'Build the pricing section', percent: 60 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /✓ Read your brand notes.*Done/ })).toBeDefined()
    expect(await ui.find({ text: /▶ Build the pricing section\s+██████░░░░\s+60%/ })).toBeDefined()
    expect(await ui.find({ text: /○ Add the contact form.*Next/ })).toBeDefined()
    expect(await ui.find({ text: /○ Polish the footer.*Up next/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'clean-view-toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  world(on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /Needs you/ })).toBeDefined()
  expect(await ui.find({ text: /Claude needs your OK to continue/ })).toBeDefined()
  expect(await ui.find({ text: /‖ / })).toBeDefined()
})

test('/simple off hides the band but keeps the button', async ($, on) => {
  world(on)
  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page'] } as never)
  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await before.find({ text: /Build the page/ })).toBeDefined()
  await before.unmount()

  await $.command.run({ command: 'simple', args: 'off' } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /Build the page/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'clean-view-toggle' }))?.text).toMatch(/OFF/)
})

test('plan_steps then report_progress at 100 checks off step one and starts step two', async ($, on) => {
  world(on)
  const planned = await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page', 'Check it works'] } as never)
  expect(planned.result).toBe('Planned 3 steps. The first one has started.')
  const noted = await $.tool.call({ tool: PROGRESS_TOOL, task: 'Read your notes', percent: 140 } as never)
  expect(noted.result).toBe('Progress noted: 100%.')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /✓ Read your notes.*Done/ })).toBeDefined()
  expect(await ui.find({ text: /▶ Build the page.*Working/ })).toBeDefined()
  expect(await ui.find({ text: /○ Check it works.*Next/ })).toBeDefined()
})

test('tools are denied before a plan exists and allowed after', async ($, on) => {
  world(on)
  const before = await $.tool.call({ tool: 'Read', file_path: '/tmp/x' } as never)
  expect(String(before.deny ?? before.text)).toMatch(/plan_steps/)

  const search = await $.tool.call({ tool: 'ToolSearch', query: 'select:x', max_results: 1 } as never)
  expect(search.deny).toBeUndefined()

  await $.tool.call({ tool: PLAN_TOOL, steps: ['Read your notes', 'Build the page'] } as never)
  const after = await $.tool.call({ tool: 'Read', file_path: '/tmp/x' } as never)
  expect(after.deny).toBeUndefined()
  expect(after.isError).toBeUndefined()
})
