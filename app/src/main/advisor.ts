import { OpenAI } from 'openai'
import { getModelApiKey, stripCodeFences, type ScreenShot } from './locate'
import type { ChatMessage, PlanStep } from './session'

const MODEL = 'muse-spark-1.3'
const BASE_URL = 'https://api.meta.ai/v1'
const MAX_HISTORY = 20
const MAX_PLAN_STEPS = 30

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
  shot?: ScreenShot
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
