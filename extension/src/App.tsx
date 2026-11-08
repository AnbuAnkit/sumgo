import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { sendChat } from './api'
import { getActiveTab, hostOf } from './tabs'
import type { TabContext, UiMessage } from './types'

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
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabContext>({ url: null, title: null })

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void getActiveTab().then(setTab)
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

      setMessages(history)
      setInput('')
      setError(null)
      setBusy(true)

      try {
        // Re-read the tab at send time so the agent always gets the current URL.
        const activeTab = await getActiveTab()
        setTab(activeTab)

        const response = await sendChat({
          messages: history.map(({ role, content }) => ({ role, content })),
          tab: activeTab,
        })

        setMessages([
          ...history,
          {
            id: newId(),
            role: 'assistant',
            content: response.reply,
            tools: response.tool_calls,
          },
        ])
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
    [busy, input, messages],
  )

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
        <span className="tab-chip" title={tab.url ?? 'No page available'}>
          {tab.url ? hostOf(tab.url) : 'no page access'}
        </span>
      </header>

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

      {error ? <div className="error">{error}</div> : null}

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder="Ask about this page…"
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
