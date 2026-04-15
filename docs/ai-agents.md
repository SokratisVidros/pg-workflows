# AI & Agent Workflows

AI agents and LLM pipelines are one of the best use cases for durable execution. LLM calls are **slow**, **expensive**, and **unreliable** — exactly the kind of work that should never be repeated unnecessarily.

pg-workflows gives you:

- **Cached step results** — if your process crashes after a $0.50 GPT-4 call, the result is already persisted. On retry, it skips the LLM call and picks up where it left off.
- **Automatic retries** — LLM APIs return 429s and 500s. Built-in exponential backoff handles transient failures without custom retry logic.
- **Human-in-the-loop** — pause an AI pipeline with `step.waitFor()` to wait for human review, approval, or feedback before continuing.
- **Observable progress** — track which step your agent is on, how far along it is, and inspect intermediate results with `checkProgress()`.
- **Long-running agents** — multi-step agents that run for minutes or hours don't need to hold a connection open. They persist state and resume.

## Why durable execution matters for AI

| Problem | Without pg-workflows | With pg-workflows |
|---------|---------------------|-------------------|
| Process crashes mid-pipeline | All LLM calls re-run from scratch | Resumes from the last completed step |
| LLM API returns 429/500 | Manual retry logic everywhere | Automatic retries with exponential backoff |
| Human review needed | Custom polling/webhook infrastructure | `step.waitFor()` — zero resource consumption while waiting |
| Debugging failed agents | Lost intermediate state | Full timeline of every step's input/output in PostgreSQL |
| Cost control | Repeated expensive LLM calls on failure | Each LLM call runs exactly once, result cached |
| Long-running pipelines | Timeout or lost connections | Runs for hours/days, state persisted in Postgres |

## Multi-Step AI Agent

```typescript
const researchAgent = workflow(
  'research-agent',
  async ({ step, input }) => {
    // Step 1: Plan the research (persisted - never re-runs on retry)
    const plan = await step.run('create-plan', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Create a research plan for: ${input.topic}` }],
      })
    })

    // Step 2: Execute each research task durably
    const findings = []
    for (const task of plan.tasks) {
      const result = await step.run(`research-${task.id}`, async () => {
        return await llm.chat({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: `Research: ${task.description}` }],
        })
      })
      findings.push(result)
    }

    // Step 3: Synthesize results
    const report = await step.run('synthesize', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Synthesize these findings: ${JSON.stringify(findings)}` }],
      })
    })

    return { plan, findings, report }
  },
  {
    retries: 3,
    timeout: 30 * 60 * 1000, // 30 minutes
  },
)
```

If the process crashes after completing 3 of 5 research tasks, the agent **resumes from task 4** — no LLM calls are wasted.

## Human-in-the-Loop AI Pipeline

```typescript
const contentPipeline = workflow(
  'ai-content-pipeline',
  async ({ step, input }) => {
    // Step 1: Generate draft with AI
    const draft = await step.run('generate-draft', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Write a blog post about: ${input.topic}` }],
      })
    })

    // Step 2: Pause for human review — costs nothing while waiting
    const review = await step.waitFor('human-review', {
      eventName: 'content-reviewed',
      timeout: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    // Step 3: Revise based on feedback
    if (review.approved) {
      return { status: 'published', content: draft }
    }

    const revision = await step.run('revise-draft', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: `Revise this draft based on feedback:\n\nDraft: ${draft}\n\nFeedback: ${review.feedback}` },
        ],
      })
    })

    return { status: 'revised', content: revision }
  },
  { retries: 3 },
)

// A reviewer approves or requests changes via your API
await engine.triggerEvent({
  runId: run.id,
  eventName: 'content-reviewed',
  data: { approved: false, feedback: 'Make the intro more engaging' },
})
```

## RAG Pipeline with Tool Use

```typescript
const ragAgent = workflow(
  'rag-agent',
  async ({ step, input }) => {
    // Step 1: Generate embeddings (cached on retry)
    const embedding = await step.run('embed-query', async () => {
      return await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: input.query,
      })
    })

    // Step 2: Search vector store
    const documents = await step.run('search-docs', async () => {
      return await vectorStore.search(embedding, { topK: 10 })
    })

    // Step 3: Generate answer with context
    const answer = await step.run('generate-answer', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Answer using these documents:\n${documents.map((d) => d.text).join('\n')}` },
          { role: 'user', content: input.query },
        ],
      })
    })

    // Step 4: Validate and fact-check
    const validation = await step.run('fact-check', async () => {
      return await llm.chat({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: `Fact-check this answer against the source documents. Answer: ${answer}` },
        ],
      })
    })

    return { answer, validation, sources: documents }
  },
  { retries: 3, timeout: 5 * 60 * 1000 },
)
```
