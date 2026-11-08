"""FastAPI entrypoint for the Chrome extension chat agent."""

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.exceptions import LangChainException

from .agent import run_agent
from .config import settings
from .history import (
    HistoryStoreError,
    append_assistant_message,
    delete_conversation,
    get_conversation,
    list_conversations,
    save_pending_messages,
)
from .schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationSummary,
    StoredMessage,
)

app = FastAPI(title="Chrome Chat Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["DELETE", "GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": settings.model,
        "missing_keys": settings.missing_keys(),
        "mongodb_configured": bool(settings.mongodb_uri),
    }


@app.get("/conversations", response_model=list[ConversationSummary])
def conversations() -> list[ConversationSummary]:
    try:
        return list_conversations()
    except HistoryStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def conversation(conversation_id: str) -> ConversationDetail:
    try:
        result = get_conversation(conversation_id)
    except HistoryStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return result


@app.delete("/conversations/{conversation_id}", status_code=204)
def remove_conversation(conversation_id: str) -> Response:
    try:
        deleted = delete_conversation(conversation_id)
    except HistoryStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return Response(status_code=204)


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    missing = settings.missing_keys()
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Server is missing credentials: {', '.join(missing)}. Add them to server/.env.",
        )

    if request.messages[-1].role != "user":
        raise HTTPException(status_code=422, detail="The last message must be from the user.")

    try:
        saved = get_conversation(request.conversation_id)
        if saved is None:
            stored_messages = [
                StoredMessage(role=message.role, content=message.content)
                for message in request.messages
            ]
        else:
            stored_messages = saved.messages
            latest = request.messages[-1]
            if (
                not stored_messages
                or stored_messages[-1].role != "user"
                or stored_messages[-1].content != latest.content
            ):
                stored_messages = [
                    *stored_messages,
                    StoredMessage(role=latest.role, content=latest.content),
                ]

        save_pending_messages(request.conversation_id, stored_messages)
    except HistoryStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    agent_request = ChatRequest(
        conversation_id=request.conversation_id,
        messages=[
            ChatMessage(role=message.role, content=message.content)
            for message in stored_messages
        ],
        tab=request.tab,
    )

    try:
        reply, tool_calls = run_agent(agent_request)
    except LangChainException as exc:
        raise HTTPException(status_code=502, detail=f"Model call failed: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 - report any agent failure to the client
        raise HTTPException(
            status_code=500, detail=f"Agent run failed: {type(exc).__name__}: {exc}"
        ) from exc

    try:
        append_assistant_message(
            request.conversation_id,
            StoredMessage(role="assistant", content=reply, tools=tool_calls),
        )
    except HistoryStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ChatResponse(
        conversation_id=request.conversation_id,
        reply=reply,
        tool_calls=tool_calls,
        tab_url=request.tab.url if request.tab else None,
    )
