import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OpenAI } from 'openai'
import { getModelApiKey, stripCodeFences, type CursorCrop, type ScreenShot } from './locate'
import type { ChatMessage, PlanStep } from './session'

const MODEL = 'muse-spark-1.3'
const BASE_URL = 'https://api.meta.ai/v1'
const MAX_HISTORY = 20
const MAX_PLAN_STEPS = 30
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
  'You are a patient Godot 4 guide for complete beginners. ' +
  'The user is learning to make games in the Godot 4 editor and you help one small action at a time.\n' +
  'Rules:\n' +
  "- Reply in the user's language (match the language of their latest message).\n" +
  "- When the user's goal is unclear, ask ONE short clarifying question instead of guessing. " +
  'In that case return "plan": null.\n' +
  '- When you give steps, put exactly one action per step. ' +
  'Only reference UI that exists in Godot 4 (docks, dialogs, menus, toolbar buttons); ' +
  'never invent panel names or buttons.\n' +
  '- Do not number the steps or instructions ("Step 2:", "2.", "2)" prefixes are forbidden) — ' +
  'numbering is added when the steps are displayed.\n' +
  '- Base the first step on the actual screen state (use the attached screenshot when one is provided). ' +
  'For an empty scene, the first step is choosing a root node type in the Scene dock (e.g. "2D Scene").\n' +
  '- You can offer to write GDScript code and to generate simple 2D sprites for the user.\n' +
  '- You cannot make 3D models. If the user asks for 3D, suggest using an external 3D generation tool, ' +
  'then guide them to import the resulting .glb/.gltf file through the FileSystem dock and place it in the scene.\n' +
  'Response format: return ONLY a single JSON object, no other text:\n' +
  '{"reply": string, "goal": string | null, "plan": [{"instruction": string, "target": string}] | null}\n' +
  '- "reply": your message to the user (short, beginner-friendly; reference step numbers when a plan is present).\n' +
  '- "goal": a one-sentence summary of the user goal. ' +
  'Set it whenever you create a new plan or change the existing plan, otherwise null. Null when "plan" is null.\n' +
  '- "plan": the full ordered list of steps, or null when you are asking a question or no pointing is needed.\n' +
  '  - "instruction": one short beginner-friendly action that names the exact element and where it is ' +
  '(e.g. "Click the + button at the top of the Scene dock"). ' +
  'Never a bare "Click to open..." without naming the element and its location.\n' +
  '  - "target": a precise visual description, with its location, of ONE visible UI element in the Godot 4 editor ' +
  'to click for that step (e.g. "the \'+\' icon button at the top-left of the Scene dock").'

export interface AdvisorResponse {
  reply: string
  goal: string | null
  plan: PlanStep[] | null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseAdvisorResponse(rawText: string): AdvisorResponse {
  const obj = JSON.parse(stripCodeFences(rawText)) as {
    reply: unknown
    goal: unknown
    plan: unknown
  }
  if (!isNonEmptyString(obj.reply)) throw new Error('Bad reply')
  const goal = obj.goal === null || obj.goal === undefined ? null : obj.goal
  if (goal !== null && !isNonEmptyString(goal)) throw new Error('Bad goal')
  let plan: PlanStep[] | null = null
  if (obj.plan !== null && obj.plan !== undefined) {
    if (!Array.isArray(obj.plan)) throw new Error('Bad plan')
    const steps = (obj.plan as unknown[])
      .filter(
        (s): s is { instruction: string; target: string } =>
          typeof s === 'object' &&
          s !== null &&
          isNonEmptyString((s as { instruction: unknown }).instruction) &&
          isNonEmptyString((s as { target: unknown }).target)
      )
      .slice(0, MAX_PLAN_STEPS)
      .map((s) => ({ instruction: s.instruction, target: s.target }))
    plan = steps.length > 0 ? steps : null
  }
  // Never log the raw response; throw sanitized errors only.
  return { reply: obj.reply, goal, plan }
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
    max_tokens: 2000,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: DEVELOPER_PROMPT },
      ...(planState ? [{ role: 'system', content: planState } as const] : []),
      ...history.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.text })),
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
    return { reply: content, goal: null, plan: null }
  }
}

export interface RecoveryRequest {
  goal: string | null
  instruction: string
  target: string
}

export interface RecoveryResponse {
  explanation: string
  recovery_target: string | null
}

function buildRecoveryPrompt(req: RecoveryRequest): string {
  return (
    'You are helping a beginner use the Godot 4 editor. ' +
    'The on-screen pointer just failed to find the UI element for the current step.\n' +
    `Goal: ${req.goal && req.goal.length > 0 ? req.goal : '(no stated goal)'}\n` +
    `Current step: ${req.instruction}\n` +
    `Missing element: ${req.target}\n` +
    'Look at the attached screenshot of the Godot 4 editor and return ONLY a single JSON object, no other text:\n' +
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
    max_tokens: 2000,
    reasoning_effort: 'low',
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

export interface LookResponse {
  answer: string
  is_correct_target: boolean | null
  point_to: string | null
}

function buildLookPrompt(question: string, context: string | undefined, hasStep: boolean): string {
  return (
    'You are helping a beginner use the Godot 4 editor. ' +
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
      max_tokens: 2000,
      reasoning_effort: 'low',
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
