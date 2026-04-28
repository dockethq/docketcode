import type { Todo } from "@opencode-ai/sdk/v2"
import { AnimatedNumber } from "@opencode-ai/ui/animated-number"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { TextStrikethrough } from "@opencode-ai/ui/text-strikethrough"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Index, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { TodoStreamItem } from "./session-composer-state"

const doneToken = "\u0000done\u0000"
const totalToken = "\u0000total\u0000"

function dot(status: Todo["status"]) {
  if (status !== "in_progress") return undefined
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      class="block"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        style={{
          animation: "var(--animate-pulse-scale)",
          "transform-origin": "center",
          "transform-box": "fill-box",
        }}
      />
    </svg>
  )
}

export function SessionTodoDock(props: {
  sessionID?: string
  todos: Todo[]
  stream?: TodoStreamItem[]
  collapseLabel: string
  expandLabel: string
  dockProgress: number
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
    height: 320,
  })

  const toggle = () => setStore("collapsed", (value) => !value)

  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const label = createMemo(() => language.t("session.todo.progress", { done: done(), total: total() }))
  const progress = createMemo(() =>
    language
      .t("session.todo.progress", { done: doneToken, total: totalToken })
      .split(/(\u0000done\u0000|\u0000total\u0000)/),
  )

  const active = createMemo(
    () =>
      props.todos.find((todo) => todo.status === "in_progress") ??
      props.todos.find((todo) => todo.status === "pending") ??
      props.todos.filter((todo) => todo.status === "completed").at(-1) ??
      props.todos[0],
  )

  const streamLabel = createMemo(() => {
    const items = props.stream
    if (!items?.length) return undefined
    // Show the deepest (most specific) activity label
    return items[items.length - 1]!.label
  })

  const preview = createMemo(() => {
    // When collapsed, prefer showing the stream activity if available
    return streamLabel() ?? active()?.content ?? ""
  })
  const collapse = useSpring(() => (store.collapsed ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const dock = createMemo(() => Math.max(0, Math.min(1, props.dockProgress)))
  const shut = createMemo(() => 1 - dock())
  const value = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const hide = createMemo(() => Math.max(value(), shut()))
  const off = createMemo(() => hide() > 0.98)
  const turn = createMemo(() => Math.max(0, Math.min(1, value())))
  const full = createMemo(() => Math.max(78, store.height))
  let contentRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = contentRef
    if (!el) return
    const update = () => {
      setStore("height", el.getBoundingClientRect().height)
    }
    update()
    createResizeObserver(el, update)
  })

  return (
    <DockTray
      data-component="session-todo-dock"
      style={{
        "overflow-x": "visible",
        "overflow-y": "hidden",
        "max-height": `${Math.max(78, full() - value() * (full() - 78))}px`,
      }}
    >
      <div ref={contentRef}>
        <div
          data-action="session-todo-toggle"
          class="pl-3 pr-2 py-2 flex items-center gap-2 overflow-visible"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggle()
          }}
        >
          <span
            class="text-14-regular text-text-strong cursor-default inline-flex items-baseline shrink-0 overflow-visible"
            aria-label={label()}
            style={{
              "--tool-motion-odometer-ms": "600ms",
              "--tool-motion-mask": "18%",
              "--tool-motion-mask-height": "0px",
              "--tool-motion-spring-ms": "560ms",
              "white-space": "pre",
              opacity: `${Math.max(0, Math.min(1, 1 - shut()))}`,
            }}
          >
            <Index each={progress()}>
              {(item) =>
                item() === doneToken ? (
                  <AnimatedNumber value={done()} />
                ) : item() === totalToken ? (
                  <AnimatedNumber value={total()} />
                ) : (
                  <span>{item()}</span>
                )
              }
            </Index>
          </span>
          <div
            data-slot="session-todo-preview"
            class="ml-1 min-w-0 overflow-hidden"
            style={{
              flex: "1 1 auto",
              "max-width": "100%",
            }}
          >
            <TextReveal
              class="text-14-regular text-text-base cursor-default"
              text={store.collapsed ? preview() : undefined}
              duration={600}
              travel={25}
              edge={17}
              spring="cubic-bezier(0.34, 1, 0.64, 1)"
              springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
              growOnly
              truncate
            />
          </div>
          <div class="ml-auto">
            <IconButton
              data-action="session-todo-toggle-button"
              data-collapsed={store.collapsed ? "true" : "false"}
              icon="chevron-down"
              size="normal"
              variant="ghost"
              style={{ transform: `rotate(${turn() * 180}deg)` }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                toggle()
              }}
              aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
            />
          </div>
        </div>

        <div
          data-slot="session-todo-list"
          aria-hidden={store.collapsed || off()}
          classList={{
            "pointer-events-none": hide() > 0.1,
          }}
          style={{
            visibility: off() ? "hidden" : "visible",
            opacity: `${Math.max(0, Math.min(1, 1 - hide()))}`,
          }}
        >
          <TodoList todos={props.todos} stream={props.stream} />
        </div>
      </div>
    </DockTray>
  )
}

function TodoList(props: { todos: Todo[]; stream?: TodoStreamItem[] }) {
  const [store, setStore] = createStore({
    stuck: false,
  })

  return (
    <div class="relative">
      <div
        class="px-3 pb-11 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar"
        style={{ "overflow-anchor": "none" }}
        onScroll={(e) => {
          setStore("stuck", e.currentTarget.scrollTop > 0)
        }}
      >
        <Index each={props.todos}>
          {(todo) => {
            const isActive = createMemo(() => todo().status === "in_progress")
            const activeItems = createMemo(() => {
              if (!isActive()) return undefined
              const items = props.stream
              if (!items?.length) return undefined
              return items
            })

            return (
              <div data-slot="todo-item-group">
                <Checkbox
                  readOnly
                  checked={todo().status === "completed"}
                  indeterminate={todo().status === "in_progress"}
                  data-in-progress={todo().status === "in_progress" ? "" : undefined}
                  data-state={todo().status}
                  icon={dot(todo().status)}
                  style={{
                    "--checkbox-align": "flex-start",
                    "--checkbox-offset": "1px",
                    transition: "opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                    opacity: todo().status === "pending" ? "0.94" : "1",
                  }}
                >
                  <TextStrikethrough
                    active={todo().status === "completed" || todo().status === "cancelled"}
                    text={todo().content}
                    class="text-14-regular min-w-0 break-words"
                    style={{
                      "line-height": "var(--line-height-normal)",
                      transition:
                        "color 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)), opacity 220ms var(--tool-motion-ease, cubic-bezier(0.22, 1, 0.36, 1))",
                      color:
                        todo().status === "completed" || todo().status === "cancelled"
                          ? "var(--text-weak)"
                          : "var(--text-strong)",
                      opacity: todo().status === "pending" ? "0.92" : "1",
                    }}
                  />
                </Checkbox>
                <Show when={activeItems()}>
                  {(items) => <TodoStreamView items={items()} />}
                </Show>
              </div>
            )
          }}
        </Index>
      </div>
      <div
        class="pointer-events-none absolute top-0 left-0 right-0 h-4 transition-opacity duration-150"
        style={{
          background: "linear-gradient(to bottom, var(--background-base), transparent)",
          opacity: store.stuck ? 1 : 0,
        }}
      />
    </div>
  )
}

/** Compact inline code snippet — last N lines of the code string */
function codeTail(code: string | undefined, maxLines = 3): string | undefined {
  if (!code) return undefined
  const lines = code.trimEnd().split("\n")
  if (lines.length <= maxLines) return code.trimEnd()
  return "…\n" + lines.slice(-maxLines).join("\n")
}

function TodoStreamView(props: { items: TodoStreamItem[] }) {
  // Show the most recent item with code content
  const latest = createMemo(() => {
    const items = props.items
    // Prefer running items, fall back to the last completed item with code
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.status === "running" && (item.code || item.filePath)) return item
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.code || item.output) return item
    }
    // Fall back to the last item even without code
    return items[items.length - 1]
  })

  return (
    <Show when={latest()}>
      {(item) => (
        <div
          data-slot="todo-stream"
          class="ml-6 mt-1 mb-0.5 overflow-hidden rounded"
          style={{
            "max-height": "80px",
            background: "var(--background-stronger)",
            border: "1px solid var(--border-weak-base)",
          }}
        >
          {/* Header: tool label + file path */}
          <div
            class="flex items-center gap-1.5 px-2 py-1"
            style={{ "border-bottom": "1px solid var(--border-weak-base)" }}
          >
            <Show when={item().status === "running"}>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  background: "var(--icon-interactive-base)",
                  "flex-shrink": "0",
                  animation: "var(--animate-pulse-scale)",
                }}
              />
            </Show>
            <TextShimmer
              text={item().label}
              class="text-11-medium text-text-weak truncate"
              active={item().status === "running"}
            />
          </div>
          {/* Code content */}
          <Show when={codeTail(item().code) ?? codeTail(item().output)}>
            {(snippet) => (
              <pre
                class="px-2 py-1 text-11-regular text-text-base overflow-hidden"
                style={{
                  margin: "0",
                  "font-family": "var(--font-mono, monospace)",
                  "white-space": "pre",
                  "overflow-x": "auto",
                  "max-height": "48px",
                  "line-height": "1.4",
                  "mask-image": "linear-gradient(to bottom, black 60%, transparent 100%)",
                  "-webkit-mask-image": "linear-gradient(to bottom, black 60%, transparent 100%)",
                }}
              >
                {snippet()}
              </pre>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
