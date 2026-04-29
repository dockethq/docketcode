import { Show } from "solid-js"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  streamLabel?: string
  streamFilePath?: string
  streamCode?: string
}

/** Show at most N lines, trimming from the top */
function codeTail(code: string, maxLines = 4): string {
  const lines = code.trimEnd().split("\n")
  if (lines.length <= maxLines) return code.trimEnd()
  return "…\n" + lines.slice(-maxLines).join("\n")
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={0}>
        <text
          flexShrink={0}
          style={{
            fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
          }}
        >
          [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
        </text>
        <text
          flexGrow={1}
          wrapMode="word"
          style={{
            fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
          }}
        >
          {props.content}
        </text>
      </box>
      <Show when={props.status === "in_progress" && props.streamLabel}>
        <box flexDirection="column" marginLeft={4}>
          <text
            style={{
              fg: theme.brand,
              dim: true,
            }}
          >
            ↳ {props.streamLabel}
          </text>
          <Show when={props.streamCode}>
            <box
              borderStyle="round"
              borderColor={theme.border}
              paddingLeft={1}
              paddingRight={1}
              marginTop={0}
            >
              <text
                style={{
                  fg: theme.textMuted,
                }}
              >
                {codeTail(props.streamCode!)}
              </text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
