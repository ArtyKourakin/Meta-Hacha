import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OpenAI } from 'openai'
import { getModelApiKey, stripCodeFences, type CursorCrop, type ScreenShot } from './locate'
import { QUALITY } from './modelConfig'
import type { ChatMessage, DiscoveryQuestion, PlanStep } from './session'
import { describeStep, isStepAction, type StepAction } from '../shared/api'

const MODEL = 'muse-spark-1.3-contributor'
const BASE_URL = 'https://api.meta.ai/v1'
const MAX_HISTORY = 20
const MAX_PLAN_STEPS = 30
const MAX_MESSAGE_CHARS = 8000
const LOOK_DEBUG = process.env['SH0_DEBUG'] === '1'

/** Save the exact crop bytes sent to the API (dev only, gitignored). */
function saveLookCrop(dataUrl: string): void {
  if (!LOOK_DEBUG || app.isPackaged) return
  try {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return
    const dir = join(__dirname, '..', '..', '..', 'spike', 'out')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'look-debug.jpg'), Buffer.from(dataUrl.slice(comma + 1), 'base64'))
  } catch {
    // Debug only; never break the flow.
  }
}

/** Log failure metadata only: never prompt, image, or model text. */
function debugLookFailure(err: unknown, crop: CursorCrop): void {
  if (!LOOK_DEBUG) return
  const e = err as {
    name?: unknown
    status?: unknown
    code?: unknown
    type?: unknown
    message?: unknown
  } | null
  const comma = crop.dataUrl.indexOf(',')
  const bytes =
    comma >= 0 ? Buffer.from(crop.dataUrl.slice(comma + 1), 'base64') : Buffer.alloc(0)
  const magic = bytes.length >= 3 ? bytes.subarray(0, 3).toString('hex') : 'none'
  const str = (v: unknown): string => (typeof v === 'string' ? v : 'none')
  const num = (v: unknown): string => (typeof v === 'number' ? String(v) : 'none')
  console.log(
    `[look] error=${str(e?.name)} status=${num(e?.status)} code=${str(e?.code)} ` +
      `type=${str(e?.type)} msg=${str(e?.message).slice(0, 300).replace(/\n/g, ' ')} ` +
      `crop=${crop.width}x${crop.height} bytes=${bytes.length} ` +
      `mime=${comma >= 0 ? crop.dataUrl.slice(0, comma) : 'none'} jpegMagic=${magic === 'ffd8ff'}`
  )
}

const DEVELOPER_PROMPT =
  'You are SH-01, a patient guide for whatever application the user is working in. ' +
  'From the screenshot, identify the app (e.g. Godot 4, Blender, Meta Ads Manager in a browser, Figma) ' +
  'and give steps for THAT app. ' +
  'Godot 4 is your strongest app; if you do not know the current app well, ' +
  'say so honestly instead of inventing UI.\n' +
  'Rules:\n' +
  "- Reply in the user's language (match the language of their latest message).\n" +
  '- Discovery before plans: set "phase" to "answer" for simple questions (answer directly, ' +
  'with a plan only if pointing helps, and ask nothing); to "clarify" when the user wants to ' +
  'BUILD or CONFIGURE something and important details are missing (ask at most 3 short ' +
  'questions in one message, each with 2-4 suggested answers in "questions"); to "confirm" ' +
  'to summarize the request as "brief" (3-6 short bullets: what, key choices, defaults you ' +
  'assumed) and ask "Is this right?"; to "plan" only after the user confirmed the brief or ' +
  'pressed "Skip questions". A "plan" MUST follow the brief. At most 2 "clarify" rounds in ' +
  'total — then move on with sensible defaults stated in the brief.\n' +
  '- When you give steps, put exactly one action per step. ' +
  'Only reference UI that really exists in the current app (docks, dialogs, menus, toolbar buttons); ' +
  'never invent panel names or buttons.\n' +
  '- Do not number the steps or instructions ("Step 2:", "2.", "2)" prefixes are forbidden) — ' +
  'numbering is added when the steps are displayed.\n' +
  '- Give at most 6 steps per plan. If the goal needs more, cover the first part, say so in "reply", ' +
  'and stop — the user can ask you to continue with the next steps.\n' +
  '- Base the first step on the actual screen state (use the attached screenshot when one is provided). ' +
  'For example, in an empty Godot scene, the first step is choosing a root node type in the Scene dock (e.g. "2D Scene").\n' +
  '- Godot 4 names only: CharacterBody2D/CharacterBody3D (never KinematicBody, KinematicBody2D or ' +
  'KinematicBody3D), Sprite2D (never Sprite), AnimatedSprite2D, CollisionShape2D, Node2D. ' +
  'Custom input actions live in Project > Project Settings > Input Map. ' +
  'GDScript must be Godot 4 syntax: @export, func _physics_process(delta), the built-in velocity property, ' +
  'move_and_slide() with no arguments.\n' +
  '- You can offer to write GDScript code and to generate simple 2D sprites for the user.\n' +
  '- You cannot make 3D models. If the user asks for 3D, suggest using an external 3D generation tool, ' +
  'then guide them to import the resulting .glb/.gltf file into their project ' +
  '(in Godot 4: through the FileSystem dock and place it in the scene).\n' +
  'Response format: return ONLY a single JSON object, no other text:\n' +
  '{"reply": string, "phase": "answer" | "clarify" | "confirm" | "plan", "questions": [{"text": string, "options": [string]}] | null, "brief": [string] | null, "goal": string | null, "plan": [{"instruction": string, "target": string | null, "action": "click" | "type" | "drag" | "shortcut" | "read" | "select", "text": string, "drop_target": string, "keys": string[], "choose": string[], "caution": string | null}] | null, "code": {"filename": string, "language": string, "content": string, "purpose": string} | null, "app": string | null, "needs_app": string | null, "needs_research": boolean}\n' +
  '- "reply": your message to the user (short, beginner-friendly; reference step numbers when a plan is present).\n' +
  '- "phase": where you are in the discovery dialogue (see the discovery rule above). ' +
  '"questions" is set only for "clarify" (null otherwise); "brief" is set for "confirm" ' +
  'and repeated on the following "plan" (null otherwise).\n' +
  '- "questions": at most 3 questions, each {"text": one short question, ' +
  '"options": 2-4 short suggested answers the user can tap}.\n' +
  '- "brief": 3-6 short bullet strings a beginner can check at a glance.\n' +
  '- "goal": a one-sentence summary of the user goal. ' +
  'Set it whenever you create a new plan or change the existing plan, otherwise null. Null when "plan" is null.\n' +
  '- "plan": the full ordered list of steps, or null when you are asking a question or no pointing is needed.\n' +
  '  - "instruction": one short beginner-friendly action that names the exact element and where it is ' +
  '(e.g. "Click the + button at the top of the Scene dock"). ' +
  'Never a bare "Click to open..." without naming the element and its location.\n' +
  '  - "target": a precise visual description, with its location, of ONE visible UI element in the current app ' +
  '(e.g. "the \'+\' icon button at the top-left of the Scene dock"). Null only for shortcut/read steps ' +
  'with nothing to point at.\n' +
  '  - "action": what the user DOES. "click" (the default) points at "target" and the user clicks it. ' +
  '"type" points at the input field in "target"; "text" is the exact text to type. ' +
  '"drag" points at "target" and at "drop_target" (a precise visual description with location); ' +
  'use it for drag-and-drop (e.g. dragging a file onto a node). ' +
  '"shortcut" shows key caps from "keys" (e.g. ["Cmd", "S"]); "target" is optional (the area that must ' +
  'be focused, or null). "read" is information-only (look, compare, remember); "target" is optional ' +
  '(null when nothing needs pointing at). ' +
  '"select" points at the dropdown, list or menu in "target"; "choose" is the ordered array of ' +
  'option labels to pick (one item for a dropdown value, several for a menu path, e.g. ' +
  '["Project", "Project Settings..."] when the first item is the menu bar entry). ' +
  'Opening a dropdown or menu and picking an item is ALWAYS one "select" step, never two steps.\n' +
  '  - "caution": one short warning when this step spends money, publishes, deletes, overwrites, ' +
  'or cannot be undone (e.g. "This starts spending your ad budget"); otherwise null. ' +
  'Never invent danger for harmless clicks.\n' +
  '- "code": provide it when the user needs a script (e.g. GDScript for movement). ' +
  '"filename" is a bare name like "player.gd" (letters, digits, _ and - only, with the right extension). ' +
  '"purpose" is one short sentence. When code is given, the plan MUST include the steps to attach it ' +
  '(e.g. drag res://ai_assets/<filename> from the FileSystem dock onto the node, ' +
  'or Inspector > Script > Load).\n' +
  '- "app": the name of the application the user is working in (e.g. "Godot 4", "Blender", "Meta Ads Manager"). ' +
  'Set it whenever you can identify the app, otherwise null.\n' +
  '- "needs_app": the name of the app the user asks about when it is NOT visible in the attached screenshot ' +
  '(e.g. "Blender"). Set it and return "plan": null instead of inventing steps; tell the user in "reply" ' +
  'to open that app (or its web version) and press "I\'m ready". Otherwise null. Judge only from an attached screenshot.\n' +
  '- "needs_research": true when you do not know the current app well enough to give exact steps ' +
  '(say so honestly in "reply"); otherwise false.\n' +
  'Format example, adapt to the real screen — these steps fit an EMPTY Godot scene only, ' +
  'never copy them when the screenshot shows a different state. Discovery first, plan last:\n' +
  'User: "make a character that moves and jumps"\n' +
  '{"reply": "A few quick questions so I guide you to the right setup.", ' +
  '"phase": "clarify", "questions": [{"text": "2D or 3D?", "options": ["2D", "3D"]}, ' +
  '{"text": "How should it move?", "options": ["Arrow keys", "WASD", "Touch"]}], ' +
  '"brief": null, "goal": null, "plan": null, ' +
  '"code": null, "app": "Godot 4", "needs_app": null, "needs_research": false}\n' +
  'User: "2D or 3D?: 2D"\n' +
  'User: "How should it move?: Arrow keys"\n' +
  '{"reply": "Is this right?", ' +
  '"phase": "confirm", "questions": null, ' +
  '"brief": ["2D character in a new scene", "Moves with arrow keys and jumps", ' +
  '"Uses CharacterBody2D with a script (default choice)"], ' +
  '"goal": null, "plan": null, ' +
  '"code": null, "app": "Godot 4", "needs_app": null, "needs_research": false}\n' +
  'User: "Yes, make the plan"\n' +
  '{"reply": "Let\'s set up your player, one step at a time.", ' +
  '"phase": "plan", "questions": null, ' +
  '"brief": ["2D character in a new scene", "Moves with arrow keys and jumps", ' +
  '"Uses CharacterBody2D with a script (default choice)"], ' +
  '"goal": "Make a 2D character that moves and jumps.", "plan": [\n' +
  '  {"instruction": "Click the \\"2D Scene\\" button under \\"Create Root Node\\" in the Scene dock", ' +
  '"target": "the \\"2D Scene\\" button under \\"Create Root Node\\" in the Scene dock", ' +
  '"action": "click", "caution": null},\n' +
  '  {"instruction": "Click the \\"+\\" button at the top-left of the Scene dock", ' +
  '"target": "the \\"+\\" icon button at the top-left of the Scene dock", ' +
  '"action": "click", "caution": null},\n' +
  '  {"instruction": "Type \\"CharacterBody2D\\" in the search field at the top of the Create New Node dialog", ' +
  '"target": "the search field at the top of the Create New Node dialog", ' +
  '"action": "type", "text": "CharacterBody2D", "caution": null},\n' +
  '  {"instruction": "Click the \\"Create\\" button at the bottom of that dialog", ' +
  '"target": "the \\"Create\\" button at the bottom of the Create New Node dialog", ' +
  '"action": "click", "caution": null},\n' +
  '  {"instruction": "With CharacterBody2D selected, click \\"+\\" again to add a Sprite2D child", ' +
  '"target": "the \\"+\\" icon button at the top-left of the Scene dock", ' +
  '"action": "click", "caution": null}],\n' +
  ' "code": null, "app": "Godot 4", "needs_app": null, "needs_research": false}'

export interface CodeBlock {
  filename: string
  language: string
  content: string
  purpose: string
}

export type AdvisorPhase = 'answer' | 'clarify' | 'confirm' | 'plan'

export function isAdvisorPhase(value: unknown): value is AdvisorPhase {
  return value === 'answer' || value === 'clarify' || value === 'confirm' || value === 'plan'
}

export interface AdvisorResponse {
  reply: string
  phase: AdvisorPhase
  questions: DiscoveryQuestion[] | null
  brief: string[] | null
  goal: string | null
  plan: PlanStep[] | null
  code: CodeBlock | null
  app: string | null
  needs_app: string | null
  needs_research: boolean
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

interface RawStep {
  instruction: unknown
  target: unknown
  action?: unknown
  text?: unknown
  drop_target?: unknown
  keys?: unknown
  choose?: unknown
  caution?: unknown
}

function parsePlanStepList(value: unknown): PlanStep[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) throw new Error('Bad plan')
  const steps = (value as unknown[])
    .filter((s): s is RawStep & { instruction: string } => {
      if (typeof s !== 'object' || s === null) return false
      const r = s as RawStep
      if (!isNonEmptyString(r.instruction)) return false
      // click/type/drag need a target; shortcut/read may omit it.
      if (!isNonEmptyString(r.target) && r.action !== 'shortcut' && r.action !== 'read') {
        return false
      }
      return true
    })
    .slice(0, MAX_PLAN_STEPS)
    .map((s) => {
      let action: StepAction = isStepAction(s.action) ? s.action : 'click'
      const target = isNonEmptyString(s.target) ? s.target : null
      const text = isNonEmptyString(s.text) ? s.text : undefined
      const dropTarget = isNonEmptyString(s.drop_target) ? s.drop_target : undefined
      const rawKeys = Array.isArray(s.keys) ? s.keys : []
      const keys = rawKeys
        .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 24)
        .slice(0, 8)
      const rawChoose = Array.isArray(s.choose) ? s.choose : []
      const choose = rawChoose
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim().slice(0, 80))
        .slice(0, 8)
      // Demote steps whose action lacks its required fields, never drop them.
      if (action === 'drag' && !dropTarget) action = 'click'
      if (action === 'type' && !text) action = 'click'
      if (action === 'shortcut' && keys.length === 0) action = target ? 'click' : 'read'
      if (action === 'select' && choose.length === 0) action = 'click'
      return {
        instruction: s.instruction,
        target,
        action,
        text,
        dropTarget,
        keys: keys.length > 0 ? keys : undefined,
        choose: choose.length > 0 ? choose : undefined,
        caution: isNonEmptyString(s.caution) ? s.caution : null
      }
    })
  return steps.length > 0 ? steps : null
}

function parseCodeBlock(value: unknown): CodeBlock | null {
  if (value === null || value === undefined) return null
  const c = value as { filename: unknown; language: unknown; content: unknown; purpose: unknown }
  if (typeof c !== 'object' || c === null) return null
  if (!isNonEmptyString(c.filename) || !isNonEmptyString(c.language)) return null
  if (!isNonEmptyString(c.content)) return null
  return {
    filename: c.filename,
    language: c.language,
    content: c.content,
    purpose: typeof c.purpose === 'string' ? c.purpose : ''
  }
}

const MAX_QUESTIONS = 3
const MAX_OPTIONS = 4
const MAX_BRIEF_BULLETS = 6
const MAX_BRIEF_BULLET_CHARS = 200

function parseQuestions(value: unknown): DiscoveryQuestion[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null
  const out: DiscoveryQuestion[] = []
  for (const q of value as unknown[]) {
    if (out.length >= MAX_QUESTIONS) break
    if (typeof q !== 'object' || q === null) continue
    const { text, options } = q as { text: unknown; options: unknown }
    if (!isNonEmptyString(text)) continue
    if (!Array.isArray(options)) continue
    const clean = (options as unknown[])
      .filter((o): o is string => isNonEmptyString(o))
      .map((o) => o.trim())
      .slice(0, MAX_OPTIONS)
    if (clean.length === 0) continue
    out.push({ text: text.trim(), options: clean })
  }
  return out.length > 0 ? out : null
}

function parseBrief(value: unknown): string[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null
  const out = (value as unknown[])
    .filter((b): b is string => isNonEmptyString(b))
    .map((b) => b.trim().slice(0, MAX_BRIEF_BULLET_CHARS))
    .filter((b) => b.length > 0)
    .slice(0, MAX_BRIEF_BULLETS)
  return out.length > 0 ? out : null
}

function parseAdvisorResponse(rawText: string): AdvisorResponse {
  const obj = JSON.parse(stripCodeFences(rawText)) as {
    reply: unknown
    phase: unknown
    questions: unknown
    brief: unknown
    goal: unknown
    plan: unknown
    code: unknown
    app: unknown
    needs_app: unknown
    needs_research: unknown
  }
  if (!isNonEmptyString(obj.reply)) throw new Error('Bad reply')
  const goal = obj.goal === null || obj.goal === undefined ? null : obj.goal
  if (goal !== null && !isNonEmptyString(goal)) throw new Error('Bad goal')
  const appName = obj.app === null || obj.app === undefined ? null : obj.app
  if (appName !== null && !isNonEmptyString(appName)) throw new Error('Bad app')
  const needsApp = obj.needs_app === null || obj.needs_app === undefined ? null : obj.needs_app
  if (needsApp !== null && !isNonEmptyString(needsApp)) throw new Error('Bad needs_app')
  const needsResearch =
    obj.needs_research === null || obj.needs_research === undefined ? false : obj.needs_research
  if (typeof needsResearch !== 'boolean') throw new Error('Bad needs_research')
  const plan = parsePlanStepList(obj.plan)
  const code = parseCodeBlock(obj.code)
  const questions = parseQuestions(obj.questions)
  const brief = parseBrief(obj.brief)
  // Demote phases whose payload is missing; infer when the model omits it.
  let phase: AdvisorPhase = isAdvisorPhase(obj.phase) ? obj.phase : plan ? 'plan' : 'answer'
  if (phase === 'clarify' && !questions) phase = 'answer'
  if (phase === 'confirm' && !brief) phase = 'answer'
  if (phase === 'plan' && !plan) phase = 'answer'
  // Never log the raw response; throw sanitized errors only.
  return { reply: obj.reply, phase, questions, brief, goal, plan, code, app: appName, needs_app: needsApp, needs_research: needsResearch }
}

/**
 * Ask the advisor for the next reply. `history` is text-only: an attached
 * screenshot goes out with the current message only, never with older ones.
 * Garbled (non-JSON) replies fall back to plain text with no plan change;
 * transport errors throw for the caller to surface.
 */
export async function chat(
  history: ChatMessage[],
  userText: string,
  shot?: ScreenShot,
  planState?: string
): Promise<AdvisorResponse> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: QUALITY.advisor.maxTokens,
    reasoning_effort: QUALITY.advisor.effort,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'developer', content: DEVELOPER_PROMPT },
      ...(planState ? [{ role: 'developer', content: planState } as const] : []),
      // Cap each message for the model so stored code blocks can't blow up context.
      ...history
        .slice(-MAX_HISTORY)
        .map((m) => ({
          role: m.role,
          content: m.text.length > MAX_MESSAGE_CHARS ? m.text.slice(0, MAX_MESSAGE_CHARS) : m.text
        })),
      shot
        ? {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: shot.dataUrl } }
            ]
          }
        : { role: 'user', content: userText }
    ]
  })
  const content = (response.choices[0]?.message.content ?? '').trim()
  if (!content) throw new Error('Empty response')
  try {
    return parseAdvisorResponse(content)
  } catch {
    return { reply: content, phase: 'answer', questions: null, brief: null, goal: null, plan: null, code: null, app: null, needs_app: null, needs_research: false }
  }
}

export interface RecoveryRequest {
  goal: string | null
  brief: string[] | null
  instruction: string
  target: string
}

export interface RecoveryResponse {
  explanation: string
  recovery_target: string | null
}

function buildRecoveryPrompt(req: RecoveryRequest): string {
  return (
    'You are helping a beginner use the application shown in the attached screenshot. ' +
    'The on-screen pointer just failed to find the UI element for the current step.\n' +
    `Goal: ${req.goal && req.goal.length > 0 ? req.goal : '(no stated goal)'}\n` +
    (req.brief && req.brief.length > 0
      ? `User's confirmed brief:\n${req.brief.map((b) => `- ${b}`).join('\n')}\n`
      : '') +
    `Current step: ${req.instruction}\n` +
    `Missing element: ${req.target}\n` +
    'Look at the screenshot of the currently open application and return ONLY a single JSON object, no other text:\n' +
    '{"explanation": string, "recovery_target": string | null}\n' +
    '- "explanation": one short, friendly sentence saying why the element is probably not visible ' +
    '(e.g. wrong workspace tab, a dialog is closed, nothing selected yet, a different scene is open). ' +
    'No jargon, no blame.\n' +
    '- "recovery_target": a precise visual description, with its location, of ONE UI element that IS visible ' +
    'in the screenshot and that the user should click first to get closer to the step ' +
    '(e.g. "the Scene tab at the top of the left dock"). ' +
    'Null only when no visible click helps.'
  )
}

function parseRecoveryResponse(rawText: string): RecoveryResponse {
  const obj = JSON.parse(stripCodeFences(rawText)) as {
    explanation: unknown
    recovery_target: unknown
  }
  if (!isNonEmptyString(obj.explanation)) throw new Error('Bad explanation')
  const target = obj.recovery_target === null || obj.recovery_target === undefined ? null : obj.recovery_target
  if (target !== null && !isNonEmptyString(target)) throw new Error('Bad recovery target')
  // Never log the raw response; throw sanitized errors only.
  return { explanation: obj.explanation, recovery_target: target }
}

/**
 * Explain why a plan step's target is not visible and name one visible
 * element to click first. Throws on transport or parse errors so the caller
 * can surface a recovery-failed message.
 */
export async function recover(req: RecoveryRequest, shot: ScreenShot): Promise<RecoveryResponse> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    // Headroom for reasoning tokens; the JSON itself is short. A small cap
    // here truncates the completion and breaks parsing.
    max_tokens: QUALITY.recover.maxTokens,
    reasoning_effort: QUALITY.recover.effort,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildRecoveryPrompt(req) },
          { type: 'image_url', image_url: { url: shot.dataUrl } }
        ]
      }
    ]
  })
  const content = (response.choices[0]?.message.content ?? '').trim()
  if (!content) throw new Error('Empty response')
  return parseRecoveryResponse(content)
}

export interface VerifyResponse {
  done: boolean
  explanation: string
  updated_remaining_steps: PlanStep[] | null
}

function buildVerifyPrompt(
  goal: string | null,
  brief: string[] | null,
  plan: PlanStep[],
  currentIndex: number
): string {
  const lines = plan.map(
    (s, i) => `${i + 1}. ${describeStep(s)}${i === currentIndex ? ' [CURRENT]' : ''}`
  )
  return (
    "You are checking a beginner's progress in the application shown in the attached screenshot.\n" +
    `Goal: ${goal && goal.length > 0 ? goal : '(no stated goal)'}\n` +
    (brief && brief.length > 0
      ? `User's confirmed brief:\n${brief.map((b) => `- ${b}`).join('\n')}\n`
      : '') +
    `Plan:\n${lines.join('\n')}\n` +
    'Has the user completed the CURRENT step? Base your answer ONLY on what is visible in the screenshot. ' +
    'If the screen shows a state the remaining steps did not expect (a dialog open, a different tab, ' +
    'an extra item), rewrite ONLY the remaining steps (after the current one) to match reality.\n' +
    'Return ONLY a single JSON object, no other text:\n' +
    '{"done": boolean, "explanation": string, "updated_remaining_steps": [{"instruction": string, "target": string | null, "action": "click" | "type" | "drag" | "shortcut" | "read" | "select", "text": string, "drop_target": string, "keys": string[], "choose": string[], "caution": string | null}] | null}\n' +
    '- "done": true if the CURRENT step is visibly complete, else false.\n' +
    '- "explanation": one short sentence saying what you see (why it is or is not done). No jargon.\n' +
    '- "updated_remaining_steps": the replacement steps AFTER the current one when the screen differs ' +
    'from the plan; otherwise null.'
  )
}

function parseVerifyResponse(rawText: string): VerifyResponse {
  const obj = JSON.parse(stripCodeFences(rawText)) as {
    done: unknown
    explanation: unknown
    updated_remaining_steps: unknown
  }
  if (typeof obj.done !== 'boolean') throw new Error('Bad done')
  if (!isNonEmptyString(obj.explanation)) throw new Error('Bad explanation')
  return {
    done: obj.done,
    explanation: obj.explanation,
    updated_remaining_steps: parsePlanStepList(obj.updated_remaining_steps)
  }
}

/**
 * Check whether the current plan step is done from a fresh screenshot.
 * Uses the recover quality kind (no new proxy kind). Throws on transport
 * or parse errors so the caller can advance anyway.
 */
export async function verifyStep(
  goal: string | null,
  brief: string[] | null,
  plan: PlanStep[],
  currentIndex: number,
  shot: ScreenShot
): Promise<VerifyResponse> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const q = QUALITY.recover
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: q.maxTokens,
    reasoning_effort: q.effort,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildVerifyPrompt(goal, brief, plan, currentIndex) },
          { type: 'image_url', image_url: { url: shot.dataUrl } }
        ]
      }
    ]
  })
  const content = (response.choices[0]?.message.content ?? '').trim()
  if (!content) throw new Error('Empty response')
  return parseVerifyResponse(content)
}

export interface LookResponse {
  answer: string
  is_correct_target: boolean | null
  point_to: string | null
}

function buildLookPrompt(question: string, context: string | undefined, hasStep: boolean): string {
  return (
    'You are helping a beginner use the application shown in the attached screenshot. ' +
    'The attached image is a close-up around the user cursor; ' +
    'a white crosshair marks the exact pixel they are pointing at.\n' +
    (context ? `${context}\n` : '') +
    `Question: ${question}\n` +
    'Return ONLY a single JSON object, no other text:\n' +
    '{"answer": string, "is_correct_target": boolean | null, "point_to": string | null}\n' +
    '- "answer": a short beginner-friendly answer (2-3 sentences max), ' +
    "in the user's language.\n" +
    '- "is_correct_target": ' +
    (hasStep
      ? 'true if the crosshair points at the element of the current plan step, else false.'
      : 'null (there is no active plan step).') +
    '\n' +
    '- "point_to": if the user is pointing at the wrong element for their step, ' +
    'a precise visual description, with its location, of the RIGHT visible element to click instead; ' +
    'else null.'
  )
}

function parseLookResponse(rawText: string, hasStep: boolean): LookResponse {
  const obj = JSON.parse(stripCodeFences(rawText)) as {
    answer: unknown
    is_correct_target: unknown
    point_to: unknown
  }
  if (!isNonEmptyString(obj.answer)) throw new Error('Bad answer')
  const correct =
    obj.is_correct_target === null || obj.is_correct_target === undefined
      ? null
      : obj.is_correct_target
  if (correct !== null && typeof correct !== 'boolean') throw new Error('Bad verdict')
  const pointTo =
    obj.point_to === null || obj.point_to === undefined ? null : obj.point_to
  if (pointTo !== null && !isNonEmptyString(pointTo)) throw new Error('Bad point_to')
  // Never log the raw response; throw sanitized errors only.
  return { answer: obj.answer, is_correct_target: hasStep ? correct : null, point_to: pointTo }
}

/**
 * Answer a question about what's under the cursor. Garbled replies fall
 * back to plain text with no verdict; transport errors throw.
 */
export async function askAboutCrop(
  question: string,
  context: string | undefined,
  hasStep: boolean,
  crop: CursorCrop
): Promise<LookResponse> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  saveLookCrop(crop.dataUrl)
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  let response
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: QUALITY.look.maxTokens,
      reasoning_effort: QUALITY.look.effort,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildLookPrompt(question, context, hasStep) },
            { type: 'image_url', image_url: { url: crop.dataUrl } }
          ]
        }
      ]
    })
  } catch (err) {
    debugLookFailure(err, crop)
    throw err
  }
  const content = (response.choices[0]?.message.content ?? '').trim()
  if (!content) throw new Error('Empty response')
  try {
    return parseLookResponse(content, hasStep)
  } catch {
    return { answer: content, is_correct_target: null, point_to: null }
  }
}

export interface ResearchResult {
  summary: string
  urls: string[]
}

const MAX_RESEARCH_CHARS = 1500
const MAX_RESEARCH_URLS = 5

/**
 * One web-search call through the Responses API (billed separately).
 * Never receives screenshots.
 */
export async function researchApp(appName: string, topic: string): Promise<ResearchResult> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.responses.create({
    model: MODEL,
    reasoning: { effort: QUALITY.research.effort },
    max_output_tokens: QUALITY.research.maxTokens,
    tools: [{ type: 'web_search' }],
    input:
      `Find the official documentation for "${topic}" in ${appName}. ` +
      'Summarize the exact UI steps (panels, menus, buttons) a beginner needs, in under 1500 characters.'
  })
  let text = ''
  const urls: string[] = []
  for (const item of response.output) {
    if (item.type !== 'message') continue
    for (const part of item.content) {
      if (part.type !== 'output_text') continue
      text = part.text
      for (const ann of part.annotations ?? []) {
        if (
          ann.type === 'url_citation' &&
          typeof ann.url === 'string' &&
          ann.url.length > 0 &&
          !urls.includes(ann.url) &&
          urls.length < MAX_RESEARCH_URLS
        ) {
          urls.push(ann.url)
        }
      }
    }
  }
  text = text.trim()
  if (!text) throw new Error('Empty research')
  return {
    summary: text.length > MAX_RESEARCH_CHARS ? `${text.slice(0, MAX_RESEARCH_CHARS)}…` : text,
    urls
  }
}
