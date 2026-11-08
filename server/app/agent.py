"""The LangChain agent: a Gemini model plus the search and tab-reading tools."""

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

from .config import settings
from .schemas import ChatRequest, TabContext, ToolCallRecord
from .tools import build_tools

BASE_PROMPT = """You are the assistant inside a Chrome extension popup. The user is \
chatting with you while browsing, so answers should be short, direct and readable in a \
narrow panel.

You have two tools:
- `read_current_tab` reads the page the user currently has open in their browser tab.
- `web_search` searches the web for anything the open page does not cover.

Decide for yourself which tool a question needs. When the user asks about "this page", \
"the article", or anything visible on screen, read the tab first instead of guessing. \
When a question needs outside facts, search the web. Cite the source URLs you used."""


def _tab_prompt(tab: TabContext | None) -> str:
    if not tab or not (tab.url or "").strip():
        return f"{BASE_PROMPT}\n\nThe user's active tab URL is not available right now."

    title = (tab.title or "").strip() or "(no title)"
    return (
        f"{BASE_PROMPT}\n\nThe user's active tab is:\n"
        f"- Title: {title}\n"
        f"- URL: {tab.url}\n\n"
        "`read_current_tab` reads exactly that URL."
    )


def _message_text(content: object) -> str:
    """Flatten a LangChain message payload into plain text.

    Gemini returns content as a list of blocks, so this handles both the plain
    string case and the structured one.
    """
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "\n".join(part for part in (p.strip() for p in parts) if part)
    return ""


def run_agent(request: ChatRequest) -> tuple[str, list[ToolCallRecord]]:
    """Run one agent turn and return the reply plus the tools it used."""
    from langchain_core.messages import AIMessage

    agent = create_agent(
        model=init_chat_model(
            settings.model,
            api_key=settings.google_api_key or None,
            request_timeout=settings.request_timeout,
            retries=0,
        ),
        tools=build_tools(request.tab),
        system_prompt=_tab_prompt(request.tab),
    )

    result = agent.invoke(
        {"messages": [m.model_dump() for m in request.messages]},
        config={"recursion_limit": 25},
    )

    messages = result.get("messages", [])
    tool_calls: list[ToolCallRecord] = []
    for message in messages:
        if isinstance(message, AIMessage):
            for call in message.tool_calls or []:
                tool_calls.append(
                    ToolCallRecord(tool=call.get("name", "unknown"), args=call.get("args") or {})
                )

    reply = ""
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            text = _message_text(message.content)
            if text:
                reply = text
                break

    if not reply:
        reply = "I could not produce an answer for that. Try rephrasing your question."

    return reply, tool_calls
