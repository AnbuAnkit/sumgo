import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import {
  getConversation,
  listConversations,
  removeConversation,
  sendChat,
} from './api'
import { getActiveTab, hostOf } from './tabs'
import type { ConversationSummary, TabContext, UiMessage } from './types'

const TOOL_LABELS: Record<string, string> = {
  read_current_tab: 'Read the open tab',
  web_search: 'Searched the web',
}

const SUGGESTIONS = [
  'Summarize this page',
  'What are the key points?',
  'Find related articles online',
]

function newId(): string {
  return crypto.randomUUID()
}

export default function App() {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabContext>({ url: null, title: null })
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [activeTab, savedConversations] = await Promise.all([
          getActiveTab(),
          listConversations(),
        ])
        if (!active) return
        setTab(activeTab)
        setConversations(savedConversations)
        if (savedConversations.length) {
          const latest = await getConversation(savedConversations[0].id)
          if (!active) return
          setConversationId(latest.id)
          setMessages(
            latest.messages.map((message, index) => ({
              id: `${latest.id}-${index}`,
              role: message.role,
              content: message.content,
              tools: message.tools,
            })),
          )
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, busy])

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()

      const text = input.trim()
      if (!text || busy) return

      const userMessage: UiMessage = { id: newId(), role: 'user', content: text }
      const history = [...messages, userMessage]
      const activeConversationId = conversationId ?? newId()

      setMessages(history)
      setConversationId(activeConversationId)
      setInput('')
      setError(null)
      setBusy(true)

      try {
        // Re-read the tab at send time so the agent always gets the current URL.
        const activeTab = await getActiveTab()
        setTab(activeTab)

        const response = await sendChat({
          conversation_id: activeConversationId,
          messages: history.map(({ role, content }) => ({ role, content })),
          tab: activeTab,
        })

        setConversationId(response.conversation_id)
        setMessages([
          ...history,
          {
            id: newId(),
            role: 'assistant',
            content: response.reply,
            tools: response.tool_calls,
          },
        ])
        try {
          setConversations(await listConversations())
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } catch (err) {
        // Put the message back in the composer so the user can just resend it.
        setError(err instanceof Error ? err.message : String(err))
        setMessages(messages)
        setInput(text)
      } finally {
        setBusy(false)
        inputRef.current?.focus()
      }
    },
    [busy, conversationId, input, messages],
  )

  const startNewConversation = () => {
    setConversationId(null)
    setMessages([])
    setInput('')
    setError(null)
    setShowHistory(false)
  }

  const openConversation = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await getConversation(id)
      setConversationId(saved.id)
      setMessages(
        saved.messages.map((message, index) => ({
          id: `${saved.id}-${index}`,
          role: message.role,
          content: message.content,
          tools: message.tools,
        })),
      )
      setShowHistory(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteConversation = async (id: string) => {
    const conversation = conversations.find((item) => item.id === id)
    if (!window.confirm(`Delete "${conversation?.title ?? 'this conversation'}" permanently?`)) {
      return
    }

    try {
      await removeConversation(id)
      setConversations((items) => items.filter((item) => item.id !== id))
      if (conversationId === id) startNewConversation()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="app">
      <header className="header">
        <span className="brand">SumGo</span>
        <button
          type="button"
          className="header-button"
          onClick={() => setShowHistory((visible) => !visible)}
          disabled={loading || busy}
        >
          {showHistory ? 'Chat' : 'History'}
        </button>
        <button
          type="button"
          className="header-button"
          onClick={startNewConversation}
          disabled={loading || busy}
        >
          New
        </button>
        <span className="tab-chip" title={tab.url ?? 'No page available'}>
          {tab.url ? hostOf(tab.url) : 'no page access'}
        </span>
      </header>

      {showHistory ? (
        <div className="history">
          <h2>Saved conversations</h2>
          <p className="history-note">
            Chats are kept in MongoDB until you delete them.
          </p>
          {conversations.length ? (
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <div className="conversation-row" key={conversation.id}>
                    <button
                      type="button"
                      className="conversation-open"
                      onClick={() => void openConversation(conversation.id)}
                    >
                      <span>{conversation.title}</span>
                      <time>{new Date(conversation.updated_at).toLocaleString()}</time>
                    </button>
                    <button
                      type="button"
                      className="conversation-delete"
                      aria-label={`Delete ${conversation.title}`}
                      title="Delete conversation"
                      onClick={() => void handleDeleteConversation(conversation.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
          ) : (
              <p className="history-empty">Your saved conversations will appear here.</p>
          )}
        </div>
      ) : (
        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && !busy ? (
              <div className="empty">
                <p>Ask about the page you have open — or anything else.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion"
                      onClick={() => setInput(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
          ) : null}

          {messages.map((message) => (
              <div key={message.id} className={`bubble ${message.role}`}>
                {message.tools?.length ? (
                  <div className="tools">
                    {message.tools.map((tool, index) => (
                      <span className="tool" key={`${message.id}-${index}`}>
                        {TOOL_LABELS[tool.tool] ?? tool.tool}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="content">{message.content}</div>
              </div>
          ))}

          {busy ? <div className="bubble assistant pending">Thinking…</div> : null}
        </div>
      )}

      {error ? <div className="error">{error}</div> : null}

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder="Ask about this page…"
          disabled={busy || loading || showHistory}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" disabled={busy || loading || showHistory || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
