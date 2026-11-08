import type {
  ChatRequestBody,
  ChatResponseBody,
  ConversationDetail,
  ConversationSummary,
} from './types'

const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new Error(
      `Could not reach the backend at ${API_BASE}. Is the FastAPI server running?`,
    )
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? `Request failed with status ${response.status}.`)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Send the latest conversation state and active tab to the FastAPI agent. */
export function sendChat(body: ChatRequestBody): Promise<ChatResponseBody> {
  return request<ChatResponseBody>('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>('/conversations')
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`)
}

export function removeConversation(id: string): Promise<void> {
  return request<void>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
