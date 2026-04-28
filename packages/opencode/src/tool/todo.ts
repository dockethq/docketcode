import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"
import { TodoID } from "../session/schema"

const parameters = z.object({
  todos: z
    .array(
      z.object({
        ...Todo.Info.shape,
        id: z.string().optional().describe("Unique identifier for the todo — omit for new todos, include to update existing"),
      }),
    )
    .describe("The updated todo list"),
})

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          // Assign IDs: only preserve system-generated IDs (tod_ prefix),
          // generate fresh IDs for new todos or LLM-invented IDs that could collide
          const resolved: Todo.Info[] = params.todos.map((t) => ({
            id: t.id && t.id.startsWith("tod") ? t.id : TodoID.ascending(),
            content: t.content,
            status: t.status,
            priority: t.priority,
          }))

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos: resolved,
          })

          return {
            title: `${resolved.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(resolved, null, 2),
            metadata: {
              todos: resolved,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
