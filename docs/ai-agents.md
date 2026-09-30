# AI and agent workflows

LLM calls are slow, cost money, and fail with 429s and 500s. Running them as workflow steps gives you:

- **Saved results.** Each `step.run` result is saved. If the process crashes or the run retries, completed LLM calls are not repeated.
- **Retries.** A thrown error retries the run with exponential backoff, resuming at the failed step.
- **Human review.** `step.waitFor` pauses the run until a reviewer responds. A paused run holds no worker or connection, whether it waits minutes or days.
- **Inspectable state.** Every step's output is in the run's `timeline`, so you can see what the agent produced up to the point it failed.

## Setup

The snippets call an `llm` helper that wraps your model provider's SDK and returns the reply as a string. Declare it once:

```typescript
// llm.ts
export declare const llm: {
  chat(params: { model: string; messages: { role: 'system' | 'user'; content: string }[] }): Promise<string>
  embed(text: string): Promise<number[]>
}

export declare const vectorStore: {
  search(embedding: number[], options: { topK: number }): Promise<{ id: string; text: string }[]>
}
```

Return plain strings and objects from LLM steps. Results are stored as `jsonb`, so an SDK response object with class instances or methods doesn't round-trip.

## Multi-step agent

A planning call produces a list of tasks. Each task is its own step, so a crash after task 3 of 5 resumes at task 4.

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'
import { llm } from './llm'

const researchAgent = workflow(
  'research-agent',
  async ({ step, input }) => {
    const tasks = await step.run('create-plan', async () => {
      const reply = await llm.chat({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: `Return a JSON array of {"id": string, "description": string} research tasks for: ${input.topic}`,
          },
        ],
      })
      return JSON.parse(reply) as { id: string; description: string }[]
    })

    const findings: string[] = []
    for (const task of tasks) {
      const finding = await step.run(`research-${task.id}`, async () => {
        return llm.chat({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: `Research: ${task.description}` }],
        })
      })
      findings.push(finding)
    }

    const report = await step.run('synthesize', async () => {
      return llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Synthesize these findings:\n\n${findings.join('\n\n')}` }],
      })
    })

    return { tasks, report }
  },
  { inputSchema: z.object({ topic: z.string() }), retries: 3 },
)
```

## Human review

Generate a draft, wait for a reviewer, then publish or revise.

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'
import { llm } from './llm'

const contentPipeline = workflow(
  'ai-content-pipeline',
  async ({ step, input }) => {
    const draft = await step.run('generate-draft', async () => {
      return llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Write a blog post about: ${input.topic}` }],
      })
    })

    const review = await step.waitFor('human-review', {
      eventName: 'content-reviewed',
      timeout: 7 * 24 * 60 * 60 * 1000,
      schema: z.object({ approved: z.boolean(), feedback: z.string().optional() }),
    })

    if (!review) {
      return { status: 'expired', content: draft }
    }

    if (review.approved) {
      return { status: 'published', content: draft }
    }

    const revision = await step.run('revise-draft', async () => {
      return llm.chat({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: `Revise this draft based on the feedback.\n\nDraft:\n${draft}\n\nFeedback:\n${review.feedback}`,
          },
        ],
      })
    })

    return { status: 'revised', content: revision }
  },
  { inputSchema: z.object({ topic: z.string() }), retries: 3 },
)
```

Send the reviewer's decision from your API:

```typescript
await engine.triggerEvent({
  runId,
  eventName: 'content-reviewed',
  data: { approved: false, feedback: 'Make the intro more engaging' },
})
```

With `timeout`, `review` is `undefined` if no event arrives within 7 days. `schema` types the event data but doesn't validate it, so check untrusted input before calling `triggerEvent`.

## Retrieval-augmented generation

Embed the query, retrieve documents, answer, then check the answer against the sources.

```typescript
import { workflow } from 'pg-workflows'
import { z } from 'zod'
import { llm, vectorStore } from './llm'

const ragAgent = workflow(
  'rag-agent',
  async ({ step, input }) => {
    const embedding = await step.run('embed-query', async () => {
      return llm.embed(input.query)
    })

    const documents = await step.run('search-docs', async () => {
      return vectorStore.search(embedding, { topK: 10 })
    })

    const context = documents.map((doc) => doc.text).join('\n')

    const answer = await step.run('generate-answer', async () => {
      return llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Answer using only these documents:\n${context}` },
          { role: 'user', content: input.query },
        ],
      })
    })

    const factCheck = await step.run('fact-check', async () => {
      return llm.chat({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: `Documents:\n${context}\n\nAnswer:\n${answer}\n\nList any claims in the answer that the documents don't support.`,
          },
        ],
      })
    })

    return { answer, factCheck, sources: documents.map((doc) => doc.id) }
  },
  { inputSchema: z.object({ query: z.string() }), retries: 3 },
)
```

## Limits to plan for

- **A step can repeat after a crash.** If the process dies after an LLM call returns but before its result is saved, the call runs again on retry. Pass an idempotency key to APIs that charge or send.
- **Execution time is capped.** A single handler execution is limited by [`WORKFLOW_RUN_EXPIRE_IN_SECONDS`](configuration.md#environment-variables) (default 300). The limit resets at every pause, so an agent that waits for review is unaffected, but a long chain of slow calls without a pause can hit it. Raise the limit or split the chain into [child workflows](core-concepts.md#child-workflows).
- **The workflow `timeout` isn't enforced.** It's saved as `run.timeoutAt`. To bound a wait, use `timeout` on `step.waitFor` or `step.poll`.
- **Code between steps must be deterministic.** The handler runs from the top on every resume. Keep LLM calls, randomness, and `Date.now()` inside steps.
