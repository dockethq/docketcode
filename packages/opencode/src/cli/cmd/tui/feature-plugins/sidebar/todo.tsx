import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"
import { getFilename } from "@opencode-ai/shared/util/path"

const id = "internal:sidebar-todo"

const STREAM_HIDDEN_TOOLS = new Set(["todowrite"])

type StreamInfo = {
  label: string
  filePath?: string
  code?: string
}

function streamLabel(tool: string, input: Record<string, unknown>): string {
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
    case "task": {
      const desc = input.description as string | undefined
      const agent = input.subagent_type as string | undefined
      if (desc && agent) return `${agent[0]!.toUpperCase()}${agent.slice(1)}: ${desc}`
      if (desc) return desc
      return "Running subagent"
    }
    default:
      return tool
  }
}

function extractCode(tool: string, input: Record<string, unknown>): { filePath?: string; code?: string } {
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
    default:
      return {}
  }
}

function getActiveStream(api: TuiPluginApi, sessionID: string): StreamInfo | undefined {
  const messages = api.state.session.messages(sessionID)
  if (!messages.length) return undefined

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return undefined

  const parts = api.state.part(lastAssistant.id)
  let latest: StreamInfo | undefined

  for (const part of parts) {
    if (part.type !== "tool") continue
    if (STREAM_HIDDEN_TOOLS.has(part.tool)) continue
    const status = part.state.status
    if (status !== "running" && status !== "pending") continue
    const input = ("input" in part.state && part.state.input) || {}
    const inputRecord = input as Record<string, unknown>
    const label = streamLabel(part.tool, inputRecord)
    const { filePath, code } = extractCode(part.tool, inputRecord)
    latest = { label, filePath, code }

    // For tasks, check the child session for deeper activity
    if (part.tool === "task" && "metadata" in part.state) {
      const meta = part.state.metadata as Record<string, unknown> | undefined
      const childID = meta?.sessionId as string | undefined
      if (childID) {
        const childStream = getActiveStream(api, childID)
        if (childStream) latest = childStream
      }
    }
  }

  return latest
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  const activeStream = createMemo(() => getActiveStream(props.api, props.session_id))

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => {
              const stream = createMemo(() => (item.status === "in_progress" ? activeStream() : undefined))
              return (
                <TodoItem
                  status={item.status}
                  content={item.content}
                  streamLabel={stream()?.label}
                  streamFilePath={stream()?.filePath}
                  streamCode={stream()?.code}
                />
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
