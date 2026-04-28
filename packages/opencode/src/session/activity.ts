import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID, ActivityID, TodoID } from "./schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Database, eq, desc, and } from "../storage"
import { ActivityTable } from "./session.sql"
import { getFilename } from "@opencode-ai/shared/util/path"

export const Info = z
  .object({
    id: z.string().describe("Unique identifier for the activity"),
    sessionID: z.string().describe("Session this activity belongs to"),
    todoID: z.string().optional().describe("Todo item this activity is associated with"),
    tool: z.string().describe("Tool that was invoked"),
    status: z.string().describe("Activity status: started, completed, error"),
    label: z.string().describe("Human-readable description of the activity"),
    filePath: z.string().optional().describe("File path being operated on"),
    content: z.string().optional().describe("Actual code content: diff, file content, command, patch"),
    childSessionID: z.string().optional().describe("Child session ID if this is a subagent task"),
    time: z
      .object({
        created: z.number(),
      })
      .describe("Timestamp of when the activity occurred"),
  })
  .meta({ ref: "Activity" })
export type Info = z.infer<typeof Info>

export const Event = {
  Recorded: BusEvent.define(
    "activity.recorded",
    z.object({
      sessionID: SessionID.zod,
      activity: Info,
    }),
  ),
}

const HIDDEN_TOOLS = new Set(["todowrite"])

export function toolLabel(tool: string, input: Record<string, unknown>): string {
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
      const taskDesc = input.description as string | undefined
      const agent = input.subagent_type as string | undefined
      if (taskDesc && agent) return `${agent[0]!.toUpperCase()}${agent.slice(1)}: ${taskDesc}`
      if (taskDesc) return taskDesc
      return "Running subagent"
    }
    case "skill":
      return input.name ? `${input.name}` : "Using skill"
    case "list":
      return input.path ? `Listing ${getFilename(input.path as string)}` : "Listing directory"
    default:
      return tool
  }
}

export function shouldRecord(tool: string): boolean {
  return !HIDDEN_TOOLS.has(tool)
}

const MAX_CONTENT_SIZE = 4096

/** Extract the actual code content from a tool's input for persistence */
export function extractContent(tool: string, input: Record<string, unknown>): { filePath?: string; content?: string } {
  let filePath: string | undefined
  let content: string | undefined
  switch (tool) {
    case "edit":
      filePath = input.filePath as string | undefined
      content = (input.new_string as string | undefined) ?? (input.old_string as string | undefined)
      break
    case "write":
      filePath = input.filePath as string | undefined
      content = input.content as string | undefined
      break
    case "bash":
      content = input.command as string | undefined
      break
    case "apply_patch":
      content = input.patch as string | undefined
      break
    case "read":
      filePath = input.filePath as string | undefined
      break
    case "grep":
      content = input.pattern as string | undefined
      break
    case "glob":
      content = input.pattern as string | undefined
      break
  }
  // Truncate large content for storage
  if (content && content.length > MAX_CONTENT_SIZE) {
    content = content.slice(0, MAX_CONTENT_SIZE) + "\n… (truncated)"
  }
  return { filePath, content }
}

export interface Interface {
  readonly record: (input: {
    sessionID: SessionID
    todoID?: string
    tool: string
    status: "started" | "completed" | "error"
    label: string
    filePath?: string
    content?: string
    childSessionID?: SessionID
  }) => Effect.Effect<Info>
  readonly get: (sessionID: SessionID, opts?: { limit?: number; todoID?: string }) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionActivity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const record = Effect.fn("Activity.record")(function* (input: {
      sessionID: SessionID
      todoID?: string
      tool: string
      status: "started" | "completed" | "error"
      label: string
      filePath?: string
      content?: string
      childSessionID?: SessionID
    }) {
      const id = ActivityID.ascending()
      const now = Date.now()

      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(ActivityTable)
            .values({
              id,
              session_id: input.sessionID,
              todo_id: (input.todoID as TodoID) ?? null,
              tool: input.tool,
              status: input.status,
              label: input.label,
              file_path: input.filePath ?? null,
              content: input.content ?? null,
              child_session_id: input.childSessionID,
              time_created: now,
            })
            .run(),
        ),
      )

      const activity: Info = {
        id: id as string,
        sessionID: input.sessionID as string,
        todoID: input.todoID,
        tool: input.tool,
        status: input.status,
        label: input.label,
        filePath: input.filePath,
        content: input.content,
        childSessionID: input.childSessionID as string | undefined,
        time: { created: now },
      }

      yield* bus.publish(Event.Recorded, {
        sessionID: input.sessionID,
        activity,
      })

      return activity
    })

    const get = Effect.fn("Activity.get")(function* (
      sessionID: SessionID,
      opts?: { limit?: number; todoID?: string },
    ) {
      const limit = opts?.limit ?? 50
      const conditions = [eq(ActivityTable.session_id, sessionID)]
      if (opts?.todoID) {
        conditions.push(eq(ActivityTable.todo_id, opts.todoID as TodoID))
      }
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(ActivityTable)
            .where(and(...conditions))
            .orderBy(desc(ActivityTable.time_created))
            .limit(limit)
            .all(),
        ),
      )
      return rows.map(
        (row): Info => ({
          id: row.id as string,
          sessionID: row.session_id as string,
          todoID: (row.todo_id as string) ?? undefined,
          tool: row.tool,
          status: row.status,
          label: row.label,
          filePath: (row.file_path as string) ?? undefined,
          content: (row.content as string) ?? undefined,
          childSessionID: (row.child_session_id as string) ?? undefined,
          time: { created: row.time_created },
        }),
      )
    })

    return Service.of({ record, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Activity from "./activity"
