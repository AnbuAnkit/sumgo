export type Role = 'user' | 'assistant'

/** A tool the agent invoked during a turn. */
export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
}

/** The tab the user has open, read with chrome.tabs.query. */
export interface TabContext {
  url: string | null
  title: string | null
}

export interface ChatRequestBody {
  conversation_id: string
  messages: { role: Role; content: string }[]
  tab: TabContext | null
}

export interface ChatResponseBody {
  conversation_id: string
  reply: string
  tool_calls: ToolCallRecord[]
  tab_url: string | null
}

export interface ConversationSummary {
  id: string
  title: string
  updated_at: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: StoredMessage[]
}

export interface StoredMessage {
  role: Role
  content: string
  tools?: ToolCallRecord[]
}

export interface UiMessage {
  id: string
  role: Role
  content: string
  tools?: ToolCallRecord[]
}
