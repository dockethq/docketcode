import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionRequest, Todo, Part, Message } from "@opencode-ai/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"
import { getFilename } from "@opencode-ai/shared/util/path"

export type TodoStreamItem = {
  tool: string
  label: string
  filePath?: string
  /** Actual code content: new_string for edit, content for write, command for bash, patch for apply_patch */
  code?: string
  /** Tool output for completed tools: bash output, file content from read, etc. */
  output?: string
  status: "running" | "completed"
  childSessionID?: string
}

export const todoState = (input: {
  count: number
  done: boolean
  live: boolean
}): "hide" | "clear" | "open" | "close" => {
  if (input.count === 0) return "hide"
  if (!input.live) return "clear"
  if (!input.done) return "open"
  return "close"
}

function toolLabel(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "read":
      return input.filePath ? `Reading ${getFilename(input.filePath as string)}` : "Reading file"
    case "edit":
      return input.filePath ? `Editing ${getFilename(input.filePath as string)}` : "Editing file"
    case "write":
      return input.filePath ? `Writing ${getFilename(input.filePath as string)}` : "Writing file"
    case "apply_patch": {
      const files = input.files as unknown[] | undefined
      return files?.length ? `Patching ${files.length} file${files.length > 1 ? "s" : ""}` : "Applying patch"
    }
    case "bash":
      return input.description ? `${input.description}` : "Running shell"
    case "glob":
      return input.pattern ? `Searching ${input.pattern}` : "Searching files"
    case "grep":
      return input.pattern ? `Grep ${input.pattern}` : "Searching code"
    case "codesearch":
      return input.query ? `Searching ${input.query}` : "Searching code"
    case "webfetch":
      return "Fetching web page"
    case "websearch":
      return input.query ? `Searching: ${input.query}` : "Searching web"
    case "task": {
      const desc = input.description as string | undefined
      const agent = input.subagent_type as string | undefined
      if (desc && agent) return `${agent[0]!.toUpperCase()}${agent.slice(1)}: ${desc}`
      if (desc) return desc
      return "Running subagent"
    }
    case "todowrite":
      return "Updating tasks"
    case "skill":
      return input.name ? `${input.name}` : "Using skill"
    case "list":
      return input.path ? `Listing ${getFilename(input.path as string)}` : "Listing directory"
    default:
      return tool
  }
}

/** Extract the actual code content from a tool's input */
function extractCode(tool: string, input: Record<string, unknown>): { code?: string; filePath?: string } {
  switch (tool) {
    case "edit":
      return {
        filePath: input.filePath as string | undefined,
        code: (input.new_string as string | undefined) ?? (input.old_string as string | undefined),
      }
    case "write":
      return {
        filePath: input.filePath as string | undefined,
        code: input.content as string | undefined,
      }
    case "bash":
      return { code: input.command as string | undefined }
    case "apply_patch":
      return { code: input.patch as string | undefined }
    case "read":
      return { filePath: input.filePath as string | undefined }
    case "grep":
      return { code: input.pattern as string | undefined }
    case "glob":
      return { code: input.pattern as string | undefined }
    default:
      return {}
  }
}

const STREAM_HIDDEN_TOOLS = new Set(["todowrite"])
/** How many recent completed tools to include in the stream */
const COMPLETED_TAIL = 3

function extractStream(
  messages: Message[] | undefined,
  parts: Record<string, Part[] | undefined>,
  childMessages?: Record<string, Message[] | undefined>,
  childParts?: Record<string, Part[] | undefined>,
): TodoStreamItem[] {
  if (!messages?.length) return []

  // Find the latest assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return []

  const msgParts = parts[lastAssistant.id]
  if (!msgParts) return []

  const running: TodoStreamItem[] = []
  const completed: TodoStreamItem[] = []

  for (const part of msgParts) {
    if (part.type !== "tool") continue
    if (STREAM_HIDDEN_TOOLS.has(part.tool)) continue

    const state = part.state
    const input = ("input" in state && state.input) || {}
    const inputRecord = input as Record<string, unknown>
    const label = toolLabel(part.tool, inputRecord)
    const { code, filePath } = extractCode(part.tool, inputRecord)

    if (state.status === "running" || state.status === "pending") {
      const childSessionID =
        part.tool === "task" && "metadata" in state
          ? (state.metadata as Record<string, unknown> | undefined)?.sessionId as string | undefined
          : undefined

      // For running tasks, recurse into child session for deeper content
      if (childSessionID && childMessages && childParts) {
        const childMsgs = childMessages[childSessionID]
        const childStream = extractStream(childMsgs, childParts ?? {})
        if (childStream.length > 0) {
          running.push({ tool: part.tool, label, filePath, code, status: "running", childSessionID })
          for (const child of childStream) {
            running.push(child)
          }
          continue
        }
      }

      running.push({ tool: part.tool, label, filePath, code, status: "running", childSessionID })
    } else if (state.status === "completed") {
      const output = "output" in state ? (state.output as string | undefined) : undefined
      completed.push({ tool: part.tool, label, filePath, code, output, status: "completed" })
    }
  }

  // Return recent completed + all running, so the UI shows what just happened + what's happening now
  return [...completed.slice(-COMPLETED_TAIL), ...running]
}

const idle = { type: "idle" as const }

export function createSessionComposerState(options?: { closeMs?: number | (() => number) }) {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    return sessionPermissionRequest(sync.data.session, sync.data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk.directory)
    })
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const todos = createMemo((): Todo[] => {
    const id = params.id
    if (!id) return []
    return globalSync.data.session_todo[id] ?? []
  })

  const stream = createMemo((): TodoStreamItem[] => {
    const id = params.id
    if (!id) return []
    const messages = sync.data.message[id]
    const parts = sync.data.part
    return extractStream(messages, parts, sync.data.message, parts)
  })

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const status = createMemo(() => {
    const id = params.id
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })

  const busy = createMemo(() => status().type !== "idle")
  const live = createMemo(() => busy() || blocked())

  const [store, setStore] = createStore({
    responding: undefined as string | undefined,
    dock: todos().length > 0 && live(),
    closing: false,
    opening: false,
  })

  const permissionResponding = createMemo(() => {
    const perm = permissionRequest()
    if (!perm) return false
    return store.responding === perm.id
  })

  const decide = (response: "once" | "always" | "reject") => {
    const perm = permissionRequest()
    if (!perm) return
    if (store.responding === perm.id) return

    setStore("responding", perm.id)
    sdk.client.permission
      .respond({ sessionID: perm.sessionID, permissionID: perm.id, response })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description })
      })
      .finally(() => {
        setStore("responding", (id) => (id === perm.id ? undefined : id))
      })
  }

  let timer: number | undefined
  let raf: number | undefined

  const closeMs = () => {
    const value = options?.closeMs
    if (typeof value === "function") return Math.max(0, value())
    if (typeof value === "number") return Math.max(0, value)
    return 400
  }

  const scheduleClose = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      setStore({ dock: false, closing: false })
      timer = undefined
    }, closeMs())
  }

  // Keep stale turn todos from reopening if the model never clears them.
  const clear = () => {
    const id = params.id
    if (!id) return
    globalSync.todo.set(id, [])
    sync.set("todo", id, [])
  }

  createEffect(
    on(
      () => [todos().length, done(), live()] as const,
      ([count, complete, active]) => {
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        const next = todoState({
          count,
          done: complete,
          live: active,
        })

        if (next === "hide") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ dock: false, closing: false, opening: false })
          return
        }

        if (next === "clear") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          clear()
          return
        }

        if (next === "open") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          const hidden = !store.dock || store.closing
          setStore({ dock: true, closing: false })
          if (hidden) {
            setStore("opening", true)
            raf = requestAnimationFrame(() => {
              setStore("opening", false)
              raf = undefined
            })
            return
          }
          setStore("opening", false)
          return
        }

        setStore({ dock: true, opening: false, closing: true })
        if (!timer) scheduleClose()
      },
    ),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  onCleanup(() => {
    if (!raf) return
    cancelAnimationFrame(raf)
  })

  return {
    blocked,
    questionRequest,
    permissionRequest,
    permissionResponding,
    decide,
    todos,
    stream,
    dock: () => store.dock,
    closing: () => store.closing,
    opening: () => store.opening,
  }
}

export type SessionComposerState = ReturnType<typeof createSessionComposerState>
