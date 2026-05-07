export type {
  AgentCard,
  Message as A2AMessage,
  Part as A2APart,
  Task as A2ATask,
  TaskStatus as A2ATaskStatus,
  Artifact as A2AArtifact,
  SecurityScheme as A2ASecurityScheme,
} from '@a2a-js/sdk'

export type TaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled' | 'rejected'

export type TextPart = { kind: 'text'; text: string }
export type DataPart = { kind: 'data'; data: Record<string, unknown> }
export type Part = TextPart | DataPart

export type ArtifactUpdateInput = {
  parts: Part[]
  delta?: boolean
  artifactId?: string
}

export type StatusUpdateEvent = {
  kind: 'status-update'
  taskId: string
  state: TaskState
  message?: string
}

export type ArtifactUpdateEvent = {
  kind: 'artifact-update'
  taskId: string
  artifact: {
    artifactId: string
    parts: Part[]
  }
  delta: boolean
}

export type A2AStreamEvent = StatusUpdateEvent | ArtifactUpdateEvent

export type A2AEmitter = {
  statusUpdate: (state: TaskState, message?: string) => void
  artifactUpdate: (input: ArtifactUpdateInput) => void
}
