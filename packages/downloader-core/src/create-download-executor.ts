import type { Executor, ExecutorContext, ExecutorEvents, ExecutorRun } from '@vidbee/task-queue'

/**
 * Route tasks by `input.options.type`. Text transcription is a separate
 * pipeline (subs → whisper); video/audio keep using YtDlpExecutor.
 */
export const createDownloadExecutor = (deps: {
  media: Executor
  text: Executor
}): Executor => ({
  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const type = (ctx.input.options as { type?: string } | undefined)?.type
    if (type === 'text') {
      return deps.text.run(ctx, events)
    }
    return deps.media.run(ctx, events)
  }
})
